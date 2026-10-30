import { afterEach, describe, expect, it } from "bun:test"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { type GenerateResult, generate, watch } from "@tskm/compiler"
import { build, createServer, type InlineConfig, type ViteDevServer } from "vite"
import { createTskmPlugin, type TskmPluginDeps, type TskmPluginOptions } from "../src/index.ts"

// Counts real compiler passes through Vite's own `createServer` / `build`.
// `generate()` is the `buildStart` path. `watch`'s `onGenerate` fires for the
// initial `generateAll` inside `watch()` and for every later file-change pass.
// Both write the sidecar, so the count is the number of times startup (and a
// later edit) actually compile.

const fixtureSrc = fileURLToPath(new URL("./fixtures/app", import.meta.url))

// Stryker runs this file from a sandbox under packages/vite, so a fixed
// relative path to @tskm/core misses. Walk up to the repo instead.
function findRepoFile(relativePath: string): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, relativePath)
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  throw new Error(`Could not locate ${relativePath}`)
}

const coreEntry = findRepoFile("packages/tskm/src/index.ts")

interface Pass {
  readonly via: "generate" | "watch"
  readonly result: GenerateResult
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  // Later disposers close the dev server; the fixture directory was registered
  // first and must be removed only after that watcher is gone.
  const pending = disposers.splice(0).reverse()
  const errors: unknown[] = []
  for (const dispose of pending) {
    try {
      await dispose()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    throw errors[0]
  }
})

function prepareFixture(): string {
  const parent = mkdtempSync(join(tmpdir(), "tskm-vite-"))
  const root = join(parent, "app")
  cpSync(fixtureSrc, root, { recursive: true })
  const spec = relative(root, coreEntry)
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          baseUrl: ".",
          paths: { "@tskm/core": [spec] },
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
  )
  disposers.push(async () => {
    rmSync(parent, { recursive: true, force: true })
  })
  return root
}

function observeCompiler(): {
  readonly deps: TskmPluginDeps
  readonly passes: Pass[]
  closed: () => number
} {
  const passes: Pass[] = []
  let closed = 0
  const deps: TskmPluginDeps = {
    generate: async (opts) => {
      const result = await generate(opts)
      passes.push({ via: "generate", result })
      return result
    },
    watch: async (opts) => {
      const controller = await watch({
        ...opts,
        onGenerate: (result) => {
          passes.push({ via: "watch", result })
          opts.onGenerate?.(result)
        },
      })
      return {
        close: async () => {
          closed += 1
          await controller.close()
        },
      }
    },
  }
  return { deps, passes, closed: () => closed }
}

function schemaSource(field: string): string {
  return `import { number, object, string } from "@tskm/core"

export const userSchema = object({
  id: string(),
  ${field}: number(),
})
`
}

function sidecarText(pass: Pass | undefined): string {
  const output = pass?.result.files[0]?.output
  if (!output) {
    return ""
  }
  return readFileSync(output, "utf8")
}

async function waitFor(predicate: () => boolean, budgetMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return predicate()
}

function devConfig(root: string, options: TskmPluginOptions, deps: TskmPluginDeps): InlineConfig {
  return {
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [createTskmPlugin({ debounceMs: 30, ...options }, deps)],
    optimizeDeps: { noDiscovery: true },
    server: {
      host: "127.0.0.1",
      port: 0,
      // Vite's own watcher would restart the server on the schema edit and
      // run another startup generate. The assertion is about tskm's watcher.
      watch: null,
      hmr: false,
      preTransformRequests: false,
    },
  }
}

async function listen(config: InlineConfig): Promise<ViteDevServer> {
  const server = await createServer(config)
  disposers.push(async () => {
    await server.close()
  })
  await server.listen()
  return server
}

describe("vite dev and build (real vite, real compiler)", () => {
  it("dev startup generates once, then again when a schema file changes", async () => {
    const root = prepareFixture()
    const observed = observeCompiler()
    await listen(devConfig(root, {}, observed.deps))
    // `listen` awaits `buildStart`. A short quiet window catches a second pass
    // that was not part of that await (the bug wrote the sidecar twice).
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(observed.passes.map((pass) => pass.via)).toEqual(["watch"])
    expect(observed.closed()).toBe(0)
    expect(observed.passes[0]?.result.diagnostics).toEqual([])
    expect(sidecarText(observed.passes[0])).toContain("age: number")

    const schemaPath = join(root, "src/user.schema.ts")
    const before = observed.passes.length
    const fired = await waitFor(() => {
      if (observed.passes.length > before) {
        return true
      }
      writeFileSync(schemaPath, schemaSource("score"))
      return false
    })

    expect(fired).toBe(true)
    expect(observed.passes.slice(before).every((pass) => pass.via === "watch")).toBe(true)
    const matched = await waitFor(() =>
      sidecarText(observed.passes.at(-1)).includes("score: number"),
    )
    expect(matched).toBe(true)
    expect(observed.passes.every((pass) => pass.via === "watch")).toBe(true)
  }, 20_000)

  it("dev with the watcher disabled generates once from buildStart", async () => {
    const root = prepareFixture()
    const observed = observeCompiler()
    await listen(devConfig(root, { watch: false }, observed.deps))
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(observed.passes.map((pass) => pass.via)).toEqual(["generate"])
    expect(observed.closed()).toBe(0)
    expect(observed.passes[0]?.result.diagnostics).toEqual([])
    expect(sidecarText(observed.passes[0])).toContain("age: number")
  }, 20_000)

  it("build generates once and does not start the watcher", async () => {
    const root = prepareFixture()
    const observed = observeCompiler()
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [createTskmPlugin({}, observed.deps)],
      build: { write: false, outDir: join(root, "dist") },
    })

    expect(observed.passes.map((pass) => pass.via)).toEqual(["generate"])
    expect(observed.closed()).toBe(0)
    expect(observed.passes[0]?.result.diagnostics).toEqual([])
    expect(sidecarText(observed.passes[0])).toContain("age: number")
  }, 20_000)
})
