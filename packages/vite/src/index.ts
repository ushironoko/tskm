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
  let controller: WatchController | undefined

  const resolveRoot = (): string | undefined => options.root ?? viteRoot

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
    },

    async buildStart() {
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
      server.httpServer?.once("close", () => {
        void closeWatcher()
      })
      return () => closeWatcher()
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
