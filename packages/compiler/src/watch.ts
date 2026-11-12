import { type FSWatcher, watch as fsWatch } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import type { TskmConfig, TskmMode } from "./config.ts"
import { loadConfig, resolveConfig } from "./config.ts"
import { createSession, type GenerateResult } from "./session.ts"

/**
 * Watch mode: keeps a single {@link createSession} alive, does an initial full
 * generate, then re-generates on file-system events (debounced/coalesced). A changed
 * source file is regenerated incrementally; structural events (tsconfig change, file
 * add/delete/rename) trigger a full regenerate.
 */

export interface WatchOptions {
  readonly root?: string
  readonly config?: TskmConfig
  /** Overrides the resolved config's emit mode. */
  readonly mode?: TskmMode
  readonly pretty?: boolean
  /** Overrides the config's debounce window (ms). */
  readonly debounceMs?: number
  /** Called after every generate pass (initial and each re-run). */
  readonly onGenerate?: (result: GenerateResult) => void
  /** Aborting this signal closes the watcher. */
  readonly signal?: AbortSignal
}

export interface WatchController {
  /** Stops watching and tears down the checker session. */
  close(): Promise<void>
}

export interface WatchEvent {
  readonly path: string
  readonly kind: "change" | "rename"
}

export interface WatchPlanContext {
  readonly tsconfigPath: string
  /** Abs paths from `session.collectSources()`. */
  readonly knownSources: ReadonlySet<string>
  /**
   * True when the output for this path was generated from its current content (see
   * {@link TskmSession.isCurrent}). Consulted for known sources only.
   */
  readonly isCurrent: (absPath: string) => boolean
}

export interface WatchPlan {
  readonly full: boolean
  readonly files: ReadonlyArray<string>
}

/** Paths the compiler itself writes; their events must never retrigger generation. */
function isGeneratedArtifact(absPath: string): boolean {
  return (
    absPath.endsWith(".gen.ts") ||
    absPath.endsWith(".tskm-query.ts") ||
    absPath.endsWith(".schema.json")
  )
}

/**
 * Pure planner: turns a coalesced batch of file-system events into a generate plan.
 * Over-approximates toward correctness — when in doubt it asks for a full rebuild.
 */
export function planWatchActions(
  events: ReadonlyArray<WatchEvent>,
  ctx: WatchPlanContext,
): WatchPlan {
  const changed = new Set<string>()
  let full = false

  for (const event of events) {
    // Our own emitted artifacts are never inputs; ignore them to avoid self-trigger loops.
    if (isGeneratedArtifact(event.path)) {
      continue
    }
    if (event.path === ctx.tsconfigPath) {
      full = true
      continue
    }
    // An event reports that something was written, not that its content changed. A known
    // source whose output already matches its content is not a change, whatever the event
    // kind. That covers writes made before watch() began (Node can deliver them to a watcher
    // attached later on the same directory) and rewrites with identical bytes. A source that
    // is gone or differs still falls through to the rules below.
    if (ctx.knownSources.has(event.path) && ctx.isCurrent(event.path)) {
      continue
    }
    // A rename is an add/delete/move: the source set itself changed, so the safe
    // response is a full rebuild rather than guessing which file appeared or vanished.
    if (event.kind === "rename") {
      full = true
      continue
    }
    if (!event.path.endsWith(".ts")) {
      continue
    }
    if (ctx.knownSources.has(event.path)) {
      changed.add(event.path)
      continue
    }
    // A `.ts` outside the source set is an untracked dependency. We don't model the
    // import closure, so any module a source might import forces a conservative full pass.
    full = true
  }

  if (full) {
    return { full: true, files: [] }
  }
  return { full: false, files: [...changed] }
}

function mergeResults(results: ReadonlyArray<GenerateResult>): GenerateResult {
  const files: GenerateResult["files"][number][] = []
  const diagnostics: string[] = []
  const errors: string[] = []
  for (const result of results) {
    files.push(...result.files)
    diagnostics.push(...result.diagnostics)
    if (result.errors) {
      errors.push(...result.errors)
    }
  }
  return errors.length > 0 ? { files, diagnostics, errors } : { files, diagnostics }
}

export async function watch(options: WatchOptions = {}): Promise<WatchController> {
  const root = resolve(options.root ?? process.cwd())
  const base = options.config ? resolveConfig(options.config, root) : await loadConfig(root)
  const config = options.mode ? { ...base, mode: options.mode } : base
  const debounceMs = options.debounceMs ?? base.watch.debounceMs

  const session = createSession(config)
  const pretty = options.pretty

  options.onGenerate?.(session.generateAll(pretty))

  // Events are only hints about what to look at. Whether a source needs regenerating is
  // decided at flush time by comparing its content with what its output was generated
  // from (session.isCurrent). That covers this process's own writes (sidecars are artifacts,
  // and an inplace rewrite is recorded with the text it wrote) and writes that predate
  // watch(), which fs.watch can still report.
  const pending = new Map<string, WatchEvent>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  function flush(): void {
    timer = undefined
    if (closed) {
      return
    }
    const batch = [...pending.values()]
    pending.clear()

    const knownSources = new Set(session.collectSources())
    const plan = planWatchActions(batch, {
      tsconfigPath: config.tsconfig,
      knownSources,
      isCurrent: session.isCurrent,
    })

    if (plan.full) {
      options.onGenerate?.(session.generateAll(pretty))
      return
    }
    if (plan.files.length === 0) {
      return
    }
    const results = plan.files.map((sourceAbs) => {
      const generated = session.generateFile(sourceAbs, pretty)
      // A full rebuild returns `errors` from generateAll. An incremental pass has to
      // forward them too, or a fail-closed schema looks like a warning.
      return {
        files: generated.file ? [generated.file] : [],
        diagnostics: generated.diagnostics,
        ...(generated.errors !== undefined && generated.errors.length > 0
          ? { errors: generated.errors }
          : {}),
      }
    })
    options.onGenerate?.(mergeResults(results))
  }

  let watcher: FSWatcher | undefined
  watcher = fsWatch(config.root, { recursive: true }, (kind, filename) => {
    if (closed || filename === null) {
      return
    }
    const abs = isAbsolute(filename) ? filename : resolve(config.root, filename)
    if (!abs.endsWith(".ts") && abs !== config.tsconfig) {
      return
    }
    // Our own outputs are never inputs. Their echoes are dropped here, so they neither wait on
    // nor restart the debounce; the planner would drop them too.
    if (isGeneratedArtifact(abs)) {
      return
    }
    const eventKind: WatchEvent["kind"] = kind === "rename" ? "rename" : "change"
    pending.set(abs, { path: abs, kind: eventKind })
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(flush, debounceMs)
  })

  async function close(): Promise<void> {
    if (closed) {
      return
    }
    closed = true
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    watcher?.close()
    watcher = undefined
    if (options.signal) {
      options.signal.removeEventListener("abort", onAbort)
    }
    session.close()
  }

  function onAbort(): void {
    void close()
  }

  if (options.signal) {
    if (options.signal.aborted) {
      await close()
    } else {
      options.signal.addEventListener("abort", onAbort)
    }
  }

  return { close }
}
