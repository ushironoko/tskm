import type { GenerateResult, TskmMode, WatchController } from "@tskm/compiler"
import { generate, watch } from "@tskm/compiler"
import type { Plugin, ResolvedConfig, ViteBuilder } from "vite"

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

  // `buildApp` calls `buildStart` once per environment (client, ssr, …). Those
  // calls share one in-flight `generate()` until every environment has reached
  // `buildEnd`. `sharedDuringBuild` keeps this closure shared; Vite still invokes
  // the hooks per environment. A single-environment build expects one `buildEnd`,
  // which drops the pass so `build --watch` compiles again on the next rebuild.
  // The next `build()` also drops it from `configResolved`.
  let environmentsThisBuild = 1
  let wave: { readonly pass: Promise<void>; finished: number } | undefined

  const resolveRoot = (): string | undefined => options.root ?? viteRoot

  // `vite dev` runs both hooks. The compiler watcher generates once as it starts
  // (`watch` → `session.generateAll` before the controller resolves), so `buildStart`
  // must not call `generate()` again or startup compiles the project twice. `vite build`
  // never calls `configureServer`, and still generates from `buildStart`.
  const devWatcherOwnsInitialGenerate = (): boolean =>
    command === "serve" && options.watch !== false

  const clearWave = (): void => {
    wave = undefined
    environmentsThisBuild = 1
  }

  const closeWatcher = async (): Promise<void> => {
    if (!controller) {
      return
    }
    const current = controller
    controller = undefined
    await current.close()
  }

  const generateOnce = (): Promise<void> => {
    if (!wave) {
      wave = {
        finished: 0,
        pass: deps
          .generate({
            root: resolveRoot(),
            mode: options.mode,
            pretty: options.pretty,
          })
          .then(logResult),
      }
    }
    return wave.pass
  }

  return {
    name: "tskm",
    // Share this instance across environments. The flag does not skip the
    // per-environment `buildStart`; `generateOnce` does.
    sharedDuringBuild: true,

    configResolved(config: ResolvedConfig) {
      viteRoot = config.root
      command = config.command
      // Each `build()` / dev server resolves config before `buildStart`.
      // Multi-environment `createBuilder` also resolves once per environment,
      // still before `buildApp`.
      clearWave()
    },

    // Plain hook (not `order: 'post'`). Vite runs `builder.buildApp` — the
    // code that actually builds each environment — before post hooks.
    async buildApp(builder: ViteBuilder) {
      clearWave()
      environmentsThisBuild = Math.max(1, Object.keys(builder.environments).length)
    },

    async buildStart() {
      if (devWatcherOwnsInitialGenerate()) {
        return
      }
      await generateOnce()
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
        wave.finished += 1
        if (wave.finished >= environmentsThisBuild) {
          clearWave()
        }
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
