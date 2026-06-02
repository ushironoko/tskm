import { afterEach, describe, expect, it } from "bun:test"
import type { GeneratedFile, GenerateResult, WatchController } from "@tskm/compiler"
import type { ResolvedConfig, ViteDevServer } from "vite"
import { createTskmPlugin, type TskmPluginDeps, tskm } from "../src/index.ts"

const emptyResult: GenerateResult = { files: [], diagnostics: [] }

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

function makeDeps(result: GenerateResult = emptyResult): {
  deps: TskmPluginDeps
  controller: WatchController & { closed: number }
  onGenerate: () => ((r: GenerateResult) => void) | undefined
  watchCalls: () => number
} {
  const controller = { closed: 0, close: async () => void controller.closed++ }
  let watchCalls = 0
  let captured: ((r: GenerateResult) => void) | undefined
  const deps: TskmPluginDeps = {
    generate: async () => result,
    watch: async (opts) => {
      watchCalls++
      captured = opts.onGenerate
      return controller
    },
  }
  return {
    deps,
    controller,
    onGenerate: () => captured,
    watchCalls: () => watchCalls,
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

function makeFile(over: Partial<GeneratedFile> = {}): GeneratedFile {
  return {
    source: "src/user.ts",
    output: "src/user.tskm.ts",
    typeNames: ["User", "Post"],
    mode: "sidecar",
    changed: true,
    ...over,
  }
}

describe("tskm vite plugin — lifecycle teardown", () => {
  it("buildEnd closes a running watcher", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)
    const { server } = makeServer()

    await callHook<Promise<unknown>>(plugin.configureServer, server)
    expect(fake.watchCalls()).toBe(1)
    expect(fake.controller.closed).toBe(0)

    await callHook<Promise<void>>(plugin.buildEnd)
    await waitFor(() => expect(fake.controller.closed).toBe(1))
  })

  it("closeBundle closes a running watcher", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)
    const { server } = makeServer()

    await callHook<Promise<unknown>>(plugin.configureServer, server)
    await callHook<Promise<void>>(plugin.closeBundle)
    await waitFor(() => expect(fake.controller.closed).toBe(1))
  })

  it("a second close is a no-op early-return once the controller is undefined", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)
    const { server } = makeServer()

    await callHook<Promise<unknown>>(plugin.configureServer, server)
    await callHook<Promise<void>>(plugin.buildEnd)
    await waitFor(() => expect(fake.controller.closed).toBe(1))

    // controller is now undefined — closeBundle must not re-invoke close().
    await callHook<Promise<void>>(plugin.closeBundle)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fake.controller.closed).toBe(1)
  })

  it("buildEnd is a no-op when no watcher was ever started", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)

    await callHook<Promise<void>>(plugin.buildEnd)
    expect(fake.controller.closed).toBe(0)
  })

  it("the configureServer teardown function closes the watcher", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)
    const { server } = makeServer()

    const teardown = await callHook<Promise<() => Promise<void>>>(plugin.configureServer, server)
    expect(typeof teardown).toBe("function")
    expect(fake.controller.closed).toBe(0)

    await teardown()
    await waitFor(() => expect(fake.controller.closed).toBe(1))
  })

  it("configureServer returns undefined (no teardown) when watch is disabled", async () => {
    const fake = makeDeps()
    const plugin = createTskmPlugin({ watch: false }, fake.deps)
    const { server } = makeServer()

    const teardown = await callHook<Promise<unknown>>(plugin.configureServer, server)
    expect(teardown).toBeUndefined()
    expect(fake.watchCalls()).toBe(0)
  })
})

describe("tskm vite plugin — logResult", () => {
  const originalLog = console.log
  const originalWarn = console.warn

  afterEach(() => {
    console.log = originalLog
    console.warn = originalWarn
  })

  it("logs each generated file and warns each diagnostic during buildStart", async () => {
    const logs: string[] = []
    const warns: string[] = []
    console.log = (...a: unknown[]) => void logs.push(a.join(" "))
    console.warn = (...a: unknown[]) => void warns.push(a.join(" "))

    const result: GenerateResult = {
      files: [
        makeFile({ output: "src/a.tskm.ts", typeNames: ["A", "B"] }),
        makeFile({ output: "src/b.tskm.ts", typeNames: ["C"] }),
      ],
      diagnostics: ["something looked off", "another note"],
    }
    const fake = makeDeps(result)
    const plugin = createTskmPlugin({}, fake.deps)

    callHook(plugin.configResolved, { root: "/abs" } as ResolvedConfig)
    await callHook<Promise<void>>(plugin.buildStart)

    expect(logs).toEqual(["tskm: src/a.tskm.ts (A, B)", "tskm: src/b.tskm.ts (C)"])
    expect(warns).toEqual(["tskm: something looked off", "tskm: another note"])
  })

  it("logs nothing when the result is empty", async () => {
    const logs: string[] = []
    const warns: string[] = []
    console.log = (...a: unknown[]) => void logs.push(a.join(" "))
    console.warn = (...a: unknown[]) => void warns.push(a.join(" "))

    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)
    await callHook<Promise<void>>(plugin.buildStart)

    expect(logs).toEqual([])
    expect(warns).toEqual([])
  })

  it("the watcher onGenerate callback routes through logResult", async () => {
    const logs: string[] = []
    const warns: string[] = []
    console.log = (...a: unknown[]) => void logs.push(a.join(" "))
    console.warn = (...a: unknown[]) => void warns.push(a.join(" "))

    const fake = makeDeps()
    const plugin = createTskmPlugin({}, fake.deps)
    const { server } = makeServer()

    await callHook<Promise<unknown>>(plugin.configureServer, server)
    const onGenerate = fake.onGenerate()
    expect(typeof onGenerate).toBe("function")

    onGenerate?.({
      files: [makeFile({ output: "src/x.tskm.ts", typeNames: ["X"] })],
      diagnostics: ["watch warned"],
    })

    expect(logs).toEqual(["tskm: src/x.tskm.ts (X)"])
    expect(warns).toEqual(["tskm: watch warned"])
  })
})

describe("tskm vite plugin — factory", () => {
  it("tskm() with no options returns the named plugin", () => {
    const plugin = tskm()
    expect(plugin.name).toBe("tskm")
    expect(typeof plugin.buildEnd).toBe("function")
    expect(typeof plugin.closeBundle).toBe("function")
  })
})
