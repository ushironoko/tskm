import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { TskmConfig } from "../src/config.ts"
import type { GenerateResult, WatchController } from "../src/index.ts"
import { watch } from "../src/watch.ts"
import { describe, expect, it } from "./test-api.ts"
import { withTestTsgo } from "./tsgo-test-executable.ts"

// The watch runtime branches the fixture scenarios do not reach: a flush that produces no
// work (a change to an already-current source), a flush that forces a full rebuild (a
// tsconfig change) with a second event restarting the debounce, and the fs-callback filter
// that ignores a non-.ts sibling write. Each drives the real fs.watch → debounce → flush
// loop against the real checker, in a throwaway temp project.

const tskmCore = fileURLToPath(new URL("../../tskm/src/index.ts", import.meta.url))
const tskmPkg = fileURLToPath(new URL("../../tskm", import.meta.url))

const TSCONFIG = `${JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    paths: { "@tskm/core": [tskmCore] },
  },
  include: ["src"],
})}\n`

function sidecarSource(field: string): string {
  return `import { object, string, number } from "@tskm/core"

export const watchSchema = object({ id: string(), ${field}: number() })
`
}

interface WatchProject {
  readonly root: string
  readonly source: string
  readonly tsconfig: string
  readonly config: TskmConfig
}

function makeWatchProject(initial: string, jsonSchema?: TskmConfig["jsonSchema"]): WatchProject {
  const root = mkdtempSync(join(tmpdir(), "tskm-watch-"))
  mkdirSync(join(root, "src"))
  if (jsonSchema) {
    // The isolated static-JSON worker resolves `@tskm/core` at runtime via node_modules.
    mkdirSync(join(root, "node_modules", "@tskm"), { recursive: true })
    try {
      symlinkSync(tskmPkg, join(root, "node_modules", "@tskm", "core"), "dir")
    } catch {
      // tsconfig paths remain the primary resolution route.
    }
  }
  const tsconfig = join(root, "tsconfig.json")
  writeFileSync(tsconfig, TSCONFIG)
  const source = join(root, "src", "watchtarget.schema.ts")
  writeFileSync(source, initial)
  const config = withTestTsgo({
    mode: "sidecar",
    include: ["src/watchtarget.schema.ts"],
    tsconfig: "tsconfig.json",
    worker: { execPath: process.execPath },
    ...(jsonSchema ? { jsonSchema } : {}),
  })
  return { root, source, tsconfig, config }
}

/** Polls until `predicate` holds or the budget elapses. */
async function waitFor(predicate: () => boolean, budgetMs = 10_000, stepMs = 80): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return predicate()
}

async function withWatch(
  project: WatchProject,
  debounceMs: number,
  body: (ctx: { calls: GenerateResult[]; controller: WatchController }) => Promise<void>,
): Promise<void> {
  const calls: GenerateResult[] = []
  const controller = await watch({
    root: project.root,
    config: project.config,
    debounceMs,
    onGenerate: (r) => calls.push(r),
  })
  try {
    await body({ calls, controller })
  } finally {
    await controller.close()
    rmSync(project.root, { recursive: true, force: true })
  }
}

describe("watch runtime — flush and fs-callback branches (real checker)", () => {
  it("regenerates on a real edit but ignores a non-.ts sibling write", async () => {
    const project = makeWatchProject(sidecarSource("size"))
    await withWatch(project, 30, async ({ calls }) => {
      expect(calls.length).toBeGreaterThanOrEqual(1)
      const afterInitial = calls.length

      // A non-.ts file in the watched tree is rejected by the fs callback before it ever
      // schedules a flush: no regeneration follows.
      writeFileSync(join(project.root, "notes.md"), "not a source\n")
      await waitFor(() => false, 400)
      expect(calls.length).toBe(afterInitial)

      // A real source edit still flows through to an incremental regenerate.
      let toggle = false
      const fired = await waitFor(() => {
        if (calls.length > afterInitial) return true
        toggle = !toggle
        writeFileSync(project.source, sidecarSource(toggle ? "count" : "total"))
        return false
      })
      expect(fired).toBe(true)
      expect(calls[calls.length - 1]?.files[0]?.source).toBe(project.source)
    })
  }, 60_000)

  it("does not regenerate when an already-current source is rewritten with identical bytes", async () => {
    const identical = sidecarSource("size")
    const project = makeWatchProject(identical)
    await withWatch(project, 30, async ({ calls }) => {
      expect(calls.length).toBeGreaterThanOrEqual(1)
      const afterInitial = calls.length

      // Rewriting the same bytes delivers a change event, but session.isCurrent sees the
      // output already matches, so the flush plans no files and returns without a pass.
      for (let i = 0; i < 6; i++) {
        writeFileSync(project.source, identical)
        await new Promise((r) => setTimeout(r, 60))
      }
      await waitFor(() => false, 300)
      expect(calls.length).toBe(afterInitial)

      // A genuine edit still regenerates, proving the watcher is live (the no-op above was
      // a real dropped flush, not a dead watcher).
      let toggle = false
      const fired = await waitFor(() => {
        if (calls.length > afterInitial) return true
        toggle = !toggle
        writeFileSync(project.source, sidecarSource(toggle ? "count" : "total"))
        return false
      })
      expect(fired).toBe(true)
    })
  }, 60_000)

  it("forces a full rebuild when the tsconfig changes, coalescing a concurrent source event", async () => {
    const project = makeWatchProject(sidecarSource("size"))
    await withWatch(project, 30, async ({ calls }) => {
      expect(calls.length).toBeGreaterThanOrEqual(1)
      const afterInitial = calls.length

      // Two events land inside one debounce window: the source write arms the timer and the
      // tsconfig write restarts it (the debounce-coalesce branch). The tsconfig event makes
      // the resulting plan a full rebuild, so the flush runs generateAll rather than an
      // incremental pass.
      let toggle = false
      const fired = await waitFor(() => {
        if (calls.length > afterInitial) return true
        toggle = !toggle
        writeFileSync(project.source, sidecarSource(toggle ? "count" : "total"))
        writeFileSync(project.tsconfig, TSCONFIG)
        return false
      })
      expect(fired).toBe(true)
      // A full rebuild regenerates the one source in the project.
      const latest = calls[calls.length - 1]
      expect(latest?.files.some((f) => f.source === project.source)).toBe(true)
      expect(existsSync(join(project.root, "src", "watchtarget.schema.gen.ts"))).toBe(true)
    })
  }, 60_000)

  it("forwards fail-closed errors from an incremental regenerate", async () => {
    // A bigint export with `jsonSchema.emit: "standard"` has no JSON representation, so each
    // pass fails closed with an `errors` entry. The incremental flush must forward those
    // errors through mergeResults (not drop them to a plain warning).
    const bigintSource = (name: string) =>
      `import { bigint, object, string } from "@tskm/core"

export const watchSchema = object({ id: string(), ${name}: bigint() })
`
    const project = makeWatchProject(bigintSource("amount"), { emit: "standard" })
    await withWatch(project, 30, async ({ calls }) => {
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0]?.errors?.some((e) => e.includes("bigint"))).toBe(true)
      const afterInitial = calls.length

      let toggle = false
      const fired = await waitFor(() => {
        if (calls.length > afterInitial) return true
        toggle = !toggle
        writeFileSync(project.source, bigintSource(toggle ? "total" : "sum"))
        return false
      })
      expect(fired).toBe(true)
      const latest = calls[calls.length - 1]
      // The incremental pass carried the error forward rather than losing it.
      expect(latest?.errors?.some((e) => e.includes("bigint"))).toBe(true)
    })
  }, 60_000)
})
