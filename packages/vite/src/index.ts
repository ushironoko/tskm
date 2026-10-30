import type { GenerateResult, TskmMode, WatchController } from "@tskm/compiler"
import { generate, watch } from "@tskm/compiler"
import type { Plugin, ResolvedConfig } from "vite"

export interface TskmPluginOptions {
  readonly root?: string
  readonly mode?: TskmMode
  readonly pretty?: boolean
  readonly debounceMs?: number
  /** Enable the dev-server watcher (default true in serve). */
  readonly watch?: boolean
}

/**
 * DI seam: the compiler's `generate`/`watch` are spawned-tsgo-heavy, so tests pass
 * fakes here instead of running the real checker.
 */
export interface TskmPluginDeps {
  readonly generate: (opts: {
    root?: string
    mode?: TskmMode
    pretty?: boolean
  }) => Promise<GenerateResult>
  readonly watch: (opts: {
    root?: string
    mode?: TskmMode
    pretty?: boolean
    debounceMs?: number
    onGenerate?: (r: GenerateResult) => void
  }) => Promise<WatchController>
}

const defaultDeps: TskmPluginDeps = { generate, watch }

function logResult(result: GenerateResult): void {
  for (const file of result.files) {
    console.log(`tskm: ${file.output} (${file.typeNames.join(", ")})`)
  }
  for (const diagnostic of result.diagnostics) {
    console.warn(`tskm: ${diagnostic}`)
  }
}

/** @internal — DI seam for tests. */
export function createTskmPlugin(options: TskmPluginOptions, deps: TskmPluginDeps): Plugin {
  // Captured from `configResolved` so `options.root` can default to Vite's root.
  let viteRoot: string | undefined
  let command: ResolvedConfig["command"] | undefined
  let controller: WatchController | undefined

  // One generate per wave of environment builds. A wave is shared with an
  // environment that has not taken it yet (client then ssr in one `buildApp`,
  // including when those `buildStart`s overlap). The same environment's next
  // `buildStart` is a rebuild and starts a new wave. `sharedDuringBuild` keeps
  // this closure shared; Vite still calls the hook per environment.
  // `configResolved` drops the wave so the next `build()` starts clean.
  // Vite 5 has no `this.environment`; every call uses "default" and therefore
  // starts a new wave, which is one generate per `buildStart`.
  let wave:
    | { readonly pass: Promise<void>; readonly consumed: Set<string>; closed: boolean }
    | undefined
  // Environments that have already taken some wave. A later rebuild must not
  // join a sibling's already-finished wave (that pass does not include this
  // rebuild's edits). The first build of an environment still may.
  let seen = new Set<string>()

  const resolveRoot = (): string | undefined => options.root ?? viteRoot

  // `vite dev` runs both hooks. The compiler watcher generates once as it starts
  // (`watch` → `session.generateAll` before the controller resolves), so `buildStart`
  // must not call `generate()` again or startup compiles the project twice. `vite build`
  // never calls `configureServer`, and still generates from `buildStart`.
  const devWatcherOwnsInitialGenerate = (): boolean =>
    command === "serve" && options.watch !== false

  const clearWave = (): void => {
    wave = undefined
    seen = new Set()
  }

  const closeWatcher = async (): Promise<void> => {
    if (!controller) {
      return
    }
    const current = controller
    controller = undefined
    await current.close()
  }

  const beginWave = (env: string): Promise<void> => {
    const consumed = new Set<string>([env])
    const pass = deps
      .generate({
        root: resolveRoot(),
        mode: options.mode,
        pretty: options.pretty,
      })
      .then(logResult)
    wave = { pass, consumed, closed: false }
    seen.add(env)
    return pass
  }

  return {
    name: "tskm",
    // Share this instance across environments so the wave above is shared too.
    sharedDuringBuild: true,

    configResolved(config: ResolvedConfig) {
      viteRoot = config.root
      command = config.command
      clearWave()
    },

    async buildStart(this: { environment?: { name?: string } } | undefined) {
      if (devWatcherOwnsInitialGenerate()) {
        return
      }
      const env = this?.environment?.name ?? "default"
      const firstTime = !seen.has(env)
      // Join when this environment has not taken the current wave, and either
      // it has never built (sequential client-then-ssr, even after `buildEnd`)
      // or the wave is still open (the other environment has not `buildEnd`ed,
      // so a shared-file rebuild can share one generate).
      // A never-built environment also joins a closed wave. If buildApp builds client,
      // rewrites schema sources, then builds ssr for the first time, ssr shares that stale pass.
      if (wave && !wave.consumed.has(env) && (firstTime || !wave.closed)) {
        wave.consumed.add(env)
        seen.add(env)
        await wave.pass
        return
      }
      await beginWave(env)
    },

    async configureServer(server) {
      if (options.watch === false || controller) {
        return
      }
      controller = await deps.watch({
        root: resolveRoot(),
        mode: options.mode,
        pretty: options.pretty,
        debounceMs: options.debounceMs,
        onGenerate: logResult,
      })
      // Vite calls a function returned from `configureServer` while the dev server
      // is still starting (after internal middleware is installed), not when it
      // closes. Returning `closeWatcher` here stopped the watcher before `listen`,
      // so later edits never regenerated. Shutdown is the http server's `close`
      // plus `buildEnd` / `closeBundle`.
      server.httpServer?.once("close", () => {
        void closeWatcher()
      })
    },

    async buildEnd() {
      if (wave) {
        wave.closed = true
      }
      await closeWatcher()
    },

    async closeBundle() {
      await closeWatcher()
    },
  }
}

export function tskm(options: TskmPluginOptions = {}): Plugin {
  return createTskmPlugin(options, defaultDeps)
}
