import type { GenerateResult, WatchController } from "@tskm/compiler"
import type { ResolvedConfig, ViteDevServer } from "vite"
import { describe, expect, it, vi } from "vitest"
import {
  createTskmPlugin,
  type TskmPluginDeps,
  type TskmPluginOptions,
  tskm,
} from "../src/index.ts"

const emptyResult: GenerateResult = { files: [], diagnostics: [] }

function makeDeps(): {
  deps: TskmPluginDeps
  generateCalls: Array<{ root?: string; mode?: string; pretty?: boolean }>
  controller: WatchController & { closed: number }
  watchCalls: number
} {
  const generateCalls: Array<{ root?: string; mode?: string; pretty?: boolean }> = []
  const controller = { closed: 0, close: async () => void controller.closed++ }
  let watchCalls = 0
  const deps: TskmPluginDeps = {
    generate: async (opts) => {
      generateCalls.push({ root: opts.root, mode: opts.mode, pretty: opts.pretty })
      return emptyResult
    },
    watch: async () => {
      watchCalls++
      return controller
    },
  }
  return {
    deps,
    generateCalls,
    controller,
    get watchCalls() {
      return watchCalls
    },
  }
}

function callHook<T>(hook: unknown, ...args: unknown[]): T {
  const fn =
    typeof hook === "function" ? hook : (hook as { handler: (...a: unknown[]) => T }).handler
  return (fn as (...a: unknown[]) => T)(...args)
}

function makeServer(): {
  server: ViteDevServer
  fireClose: () => void
} {
  let closeCb: (() => void) | undefined
  const server = {
    httpServer: {
      once(event: string, cb: () => void) {
        if (event === "close") {
          closeCb = cb
        }
      },
    },
    config: {},
  } as unknown as ViteDevServer
  return {
    server,
    fireClose: () => closeCb?.(),
  }
}

describe("tskm vite plugin", () => {
  it("returns a plugin named tskm with function hooks", () => {
    for (const plugin of [tskm(), createTskmPlugin({}, makeDeps().deps)]) {
      expect(plugin.name).toBe("tskm")
      expect(typeof plugin.buildStart).toBe("function")
      expect(typeof plugin.configResolved).toBe("function")
      expect(typeof plugin.configureServer).toBe("function")
    }
  })

  it("buildStart calls generate with the resolved root/mode/pretty", async () => {
    const fake = makeDeps()
    const options: TskmPluginOptions = { mode: "inplace", pretty: false }
    const plugin = createTskmPlugin(options, fake.deps)

    callHook(plugin.configResolved, { root: "/abs/project" } as ResolvedConfig)
    await callHook<Promise<void>>(plugin.buildStart)

    expect(fake.generateCalls).toEqual([{ root: "/abs/project", mode: "inplace", pretty: false }])
  })

  it("options.root overrides Vite's resolved root", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({ root: "/explicit" }, fake.deps)

    callHook(plugin.configResolved, { root: "/vite/root" } as ResolvedConfig)
    await callHook<Promise<void>>(plugin.buildStart)

    expect(fake.generateCalls[0]?.root).toBe("/explicit")
  })

  it("configureServer starts the watcher once and closes it on httpServer close", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)
    const { server, fireClose } = makeServer()

    await callHook<Promise<unknown>>(plugin.configureServer, server)
    expect(fake.watchCalls).toBe(1)

    // A second server pass must not spawn another watcher.
    await callHook<Promise<unknown>>(plugin.configureServer, server)
    expect(fake.watchCalls).toBe(1)

    expect(fake.controller.closed).toBe(0)
    fireClose()
    await vi.waitFor(() => expect(fake.controller.closed).toBe(1))
  })

  it("watch === false does not start a watcher", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({ watch: false }, fake.deps)
    const { server } = makeServer()

    await callHook<Promise<unknown>>(plugin.configureServer, server)
    expect(fake.watchCalls).toBe(0)
  })
})
