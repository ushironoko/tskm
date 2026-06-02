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
  for (const result of results) {
    files.push(...result.files)
    diagnostics.push(...result.diagnostics)
  }
  return { files, diagnostics }
}

export async function watch(options: WatchOptions = {}): Promise<WatchController> {
  const root = resolve(options.root ?? process.cwd())
  const base = options.config ? resolveConfig(options.config, root) : await loadConfig(root)
  const config = options.mode ? { ...base, mode: options.mode } : base
  const debounceMs = options.debounceMs ?? base.watch.debounceMs

  const session = createSession(config)
  const pretty = options.pretty

  // Abs paths this process just wrote (sidecars, or in inplace mode the source itself).
  // The kernel reports those writes back through fs.watch; suppressing the very next
  // event for each path stops a generate pass from retriggering itself. Cleared every
  // tick so a genuine user edit landing later is still seen.
  const selfWrites = new Set<string>()

  function recordSelfWrites(result: GenerateResult): void {
    for (const file of result.files) {
      if (file.changed) {
        selfWrites.add(file.output)
      }
    }
  }

  function emit(result: GenerateResult): void {
    recordSelfWrites(result)
    options.onGenerate?.(result)
  }

  emit(session.generateAll(pretty))

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
    })

    // A fresh tick: the prior pass's writes have been observed (or never arrived),
    // so any path edited from here on must be treated as a real change.
    selfWrites.clear()

    if (plan.full) {
      emit(session.generateAll(pretty))
      return
    }
    if (plan.files.length === 0) {
      return
    }
    const results = plan.files.map((sourceAbs) => {
      const { file, diagnostics } = session.generateFile(sourceAbs, pretty)
      return { files: file ? [file] : [], diagnostics }
    })
    emit(mergeResults(results))
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
    // Drop the echo of our own write so a generate pass can't retrigger itself.
    if (selfWrites.has(abs)) {
      selfWrites.delete(abs)
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
