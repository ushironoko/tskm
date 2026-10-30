import { describe, expect, it } from "bun:test"
import type { GenerateResult, WatchController } from "@tskm/compiler"
import type { ResolvedConfig, ViteDevServer } from "vite"
import {
  createTskmPlugin,
  type TskmPluginDeps,
  type TskmPluginOptions,
  tskm,
} from "../src/index.ts"

const emptyResult: GenerateResult = { files: [], diagnostics: [] }

// Polls an assertion until it passes or the timeout elapses — a local stand-in for
// vitest's `vi.waitFor`, used to await the async watcher close.
async function waitFor(assertion: () => void, timeout = 1000): Promise<void> {
  const start = Date.now()
  for (;;) {
    try {
      assertion()
      return
    } catch (error) {
      if (Date.now() - start > timeout) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

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
  return callHookOn<T>(undefined, hook, ...args)
}

function callHookOn<T>(receiver: unknown, hook: unknown, ...args: unknown[]): T {
  const fn =
    typeof hook === "function" ? hook : (hook as { handler: (...a: unknown[]) => T }).handler
  return (fn as (this: unknown, ...a: unknown[]) => T).call(receiver, ...args)
}

function envContext(name: string): { environment: { name: string } } {
  return { environment: { name } }
}

async function buildStartAs(plugin: { buildStart?: unknown }, environment?: string): Promise<void> {
  await callHookOn<Promise<void>>(
    environment ? envContext(environment) : undefined,
    plugin.buildStart,
  )
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
      expect(plugin.sharedDuringBuild).toBe(true)
      expect(typeof plugin.buildStart).toBe("function")
      expect(typeof plugin.configResolved).toBe("function")
      expect(typeof plugin.configureServer).toBe("function")
    }
  })

  it("buildStart skips generate when the dev watcher owns the initial pass", async () => {
    for (const watch of [undefined, true] as const) {
      const fake = makeDeps()
      const plugin = createTskmPlugin({ watch }, fake.deps)

      callHook(plugin.configResolved, { root: "/abs/project", command: "serve" } as ResolvedConfig)
      await callHook<Promise<void>>(plugin.buildStart)

      expect(fake.generateCalls).toEqual([])
    }
  })

  it("buildStart still generates in dev when the watcher is disabled", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({ watch: false }, fake.deps)

    callHook(plugin.configResolved, { root: "/abs/project", command: "serve" } as ResolvedConfig)
    await callHook<Promise<void>>(plugin.buildStart)

    expect(fake.generateCalls).toEqual([
      { root: "/abs/project", mode: undefined, pretty: undefined },
    ])
  })

  it("buildStart generates for a production build", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({ watch: true }, fake.deps)

    callHook(plugin.configResolved, { root: "/abs/project", command: "build" } as ResolvedConfig)
    await callHook<Promise<void>>(plugin.buildStart)

    expect(fake.generateCalls).toEqual([
      { root: "/abs/project", mode: undefined, pretty: undefined },
    ])
  })

  it("the same environment generates again on its next buildStart", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)

    await buildStartAs(plugin, "client")
    await callHook<Promise<void>>(plugin.buildEnd)
    await buildStartAs(plugin, "client")

    expect(fake.generateCalls).toHaveLength(2)
  })

  it("another environment joins the wave once, including after buildEnd", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)

    await buildStartAs(plugin, "client")
    await callHook<Promise<void>>(plugin.buildEnd)
    await buildStartAs(plugin, "ssr")

    expect(fake.generateCalls).toHaveLength(1)
  })

  it("overlapping environment buildStarts share one generate", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)

    await Promise.all([buildStartAs(plugin, "client"), buildStartAs(plugin, "ssr")])
    expect(fake.generateCalls).toHaveLength(1)

    await callHook<Promise<void>>(plugin.buildEnd)
    await Promise.all([buildStartAs(plugin, "client"), buildStartAs(plugin, "ssr")])
    expect(fake.generateCalls).toHaveLength(2)
  })

  it("a later rebuild of the other environment does not reuse a finished wave", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)

    await buildStartAs(plugin, "client")
    await buildStartAs(plugin, "ssr")
    expect(fake.generateCalls).toHaveLength(1)

    await callHook<Promise<void>>(plugin.buildEnd)
    await buildStartAs(plugin, "client")
    expect(fake.generateCalls).toHaveLength(2)

    await callHook<Promise<void>>(plugin.buildEnd)
    await buildStartAs(plugin, "ssr")
    expect(fake.generateCalls).toHaveLength(3)
  })

  it("configResolved starts a new generate after a partial multi-environment build", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)

    await buildStartAs(plugin, "client")
    expect(fake.generateCalls).toHaveLength(1)

    callHook(plugin.configResolved, { root: "/abs/project", command: "build" } as ResolvedConfig)
    await buildStartAs(plugin, "client")
    expect(fake.generateCalls).toHaveLength(2)
  })

  it("a failed generate is not reused by the next build", async () => {
    let calls = 0
    const plugin = createTskmPlugin(
      {},
      {
        generate: async () => {
          calls += 1
          if (calls === 1) {
            throw new Error("tsgo failed")
          }
          return emptyResult
        },
        watch: async () => ({ close: async () => {} }),
      },
    )

    callHook(plugin.configResolved, { root: "/abs/project", command: "build" } as ResolvedConfig)
    await expect(callHook<Promise<void>>(plugin.buildStart)).rejects.toThrow("tsgo failed")
    await callHook<Promise<void>>(plugin.buildEnd)
    await callHook<Promise<void>>(plugin.buildStart)
    expect(calls).toBe(2)
  })

  it("dev shutdown does not consume a later production generate", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)

    callHook(plugin.configResolved, { root: "/abs/project", command: "serve" } as ResolvedConfig)
    await callHook<Promise<void>>(plugin.buildStart)
    await callHook<Promise<void>>(plugin.buildEnd)

    callHook(plugin.configResolved, { root: "/abs/project", command: "build" } as ResolvedConfig)
    await callHook<Promise<void>>(plugin.buildStart)
    expect(fake.generateCalls).toHaveLength(1)
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
    await waitFor(() => expect(fake.controller.closed).toBe(1))
  })

  it("watch === false does not start a watcher", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({ watch: false }, fake.deps)
    const { server } = makeServer()

    await callHook<Promise<unknown>>(plugin.configureServer, server)
    expect(fake.watchCalls).toBe(0)
  })
})
