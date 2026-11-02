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

  const resolveRoot = (): string | undefined => options.root ?? viteRoot

  // `vite dev` runs both hooks. The compiler watcher generates once as it starts
  // (`watch` → `session.generateAll` before the controller resolves), so `buildStart`
  // must not call `generate()` again or startup compiles the project twice. `vite build`
  // never calls `configureServer`, and still generates from `buildStart`.
  const devWatcherOwnsInitialGenerate = (): boolean =>
    command === "serve" && options.watch !== false

  const closeWatcher = async (): Promise<void> => {
    if (!controller) {
      return
    }
    const current = controller
    controller = undefined
    await current.close()
  }

  return {
    name: "tskm",

    configResolved(config: ResolvedConfig) {
      viteRoot = config.root
      command = config.command
    },

    async buildStart() {
      if (devWatcherOwnsInitialGenerate()) {
        return
      }
      const result = await deps.generate({
        root: resolveRoot(),
        mode: options.mode,
        pretty: options.pretty,
      })
      logResult(result)
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
