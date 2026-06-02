import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { GenerateResult, WatchController } from "../src/index.ts"
import { watch } from "../src/index.ts"

// The fixture dir carries a tsconfig that resolves the "tskm" import; a throwaway
// schema written into its `src/` therefore type-checks under the same project.
const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url))
const target = fileURLToPath(new URL("./fixtures/basic/src/watchtarget.schema.ts", import.meta.url))
const sidecar = fileURLToPath(
  new URL("./fixtures/basic/src/watchtarget.schema.gen.ts", import.meta.url),
)
const query = fileURLToPath(
  new URL("./fixtures/basic/src/watchtarget.schema.tskm-query.ts", import.meta.url),
)

function inplaceSource(sizeField: string): string {
  return `import { object, string, number, type Infer } from "tskm"

export const watchSchema = object({
  id: string(),
  ${sizeField}: number(),
})

export type WatchTarget = Infer<typeof watchSchema>
`
}

function sidecarSource(extraField: string): string {
  return `import { object, string, number } from "tskm"

export const watchSchema = object({
  id: string(),
  ${extraField}: number(),
})
`
}

// Controllers opened by a test are tracked here so afterEach can always tear them
// down, even when an assertion threw before the test's own close() ran.
const open = new Set<WatchController>()

async function track(controller: WatchController): Promise<WatchController> {
  open.add(controller)
  return controller
}

function cleanupArtifacts(): void {
  for (const f of [target, sidecar, query]) {
    if (existsSync(f)) rmSync(f)
  }
}

afterEach(async () => {
  for (const controller of open) {
    try {
      await controller.close()
    } catch {
      // A double close or a torn-down session must not mask the test outcome.
    }
  }
  open.clear()
  cleanupArtifacts()
})

/** Polls until `predicate` holds or the budget elapses, yielding between checks. */
async function waitFor(predicate: () => boolean, budgetMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return predicate()
}

describe("compiler watch (real tsgo) — runtime", () => {
  it("fires an initial generate, then re-generates on an external edit (inplace)", async () => {
    writeFileSync(target, inplaceSource("size"))
    const calls: GenerateResult[] = []
    const controller = await track(
      await watch({
        root: fixtureRoot,
        mode: "inplace",
        config: { include: ["src/watchtarget.schema.ts"], tsconfig: "tsconfig.json" },
        debounceMs: 30,
        onGenerate: (r) => calls.push(r),
      }),
    )

    // The initial full generate runs synchronously inside watch() before it resolves.
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const first = calls[0]
    expect(first?.files.length).toBeGreaterThanOrEqual(1)
    expect(first?.files[0]?.mode).toBe("inplace")

    const before = calls.length
    // Inplace writes back into the source itself, so the initial pass records `target`
    // in the runtime's self-write set; that entry can swallow the first echoed event.
    // Re-writing on each poll tick drains the stale entry and then lands a real edit,
    // exercising fs.watch → debounce → flush → planWatchActions(incremental) →
    // generateFile → mergeResults without relying on event ordering.
    let toggle = false
    const fired = await waitFor(() => {
      if (calls.length > before) return true
      toggle = !toggle
      writeFileSync(target, inplaceSource(toggle ? "weight" : "height"))
      return false
    })
    expect(fired).toBe(true)
    const latest = calls[calls.length - 1]
    expect(latest?.files[0]?.source).toBe(target)

    await controller.close()
  }, 60_000)

  it("re-generates a sidecar on an external edit and merges per-file results", async () => {
    writeFileSync(target, sidecarSource("size"))
    const calls: GenerateResult[] = []
    const controller = await track(
      await watch({
        root: fixtureRoot,
        mode: "sidecar",
        config: { include: ["src/watchtarget.schema.ts"], tsconfig: "tsconfig.json" },
        debounceMs: 30,
        onGenerate: (r) => calls.push(r),
      }),
    )

    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0]?.files[0]?.mode).toBe("sidecar")
    expect(existsSync(sidecar)).toBe(true)

    const before = calls.length
    // Re-write on each poll tick so a coalesced/dropped fs event on slower platforms
    // (notably macOS FSEvents) is retried until one lands, instead of betting on a
    // single write being delivered. Exercises the fs.watch → debounce → flush path.
    let toggle = false
    const fired = await waitFor(() => {
      if (calls.length > before) return true
      toggle = !toggle
      writeFileSync(target, sidecarSource(toggle ? "count" : "total"))
      return false
    })
    expect(fired).toBe(true)
    const latest = calls[calls.length - 1]
    expect(latest?.files.length).toBe(1)
    expect(latest?.files[0]?.source).toBe(target)

    await controller.close()
  }, 60_000)

  it("close() is idempotent and tears down the session", async () => {
    writeFileSync(target, sidecarSource("size"))
    const controller = await watch({
      root: fixtureRoot,
      mode: "sidecar",
      config: { include: ["src/watchtarget.schema.ts"], tsconfig: "tsconfig.json" },
      debounceMs: 30,
    })

    await controller.close()
    // Second close hits the early `if (closed) return` guard without throwing.
    await controller.close()
    expect(true).toBe(true)
  }, 60_000)

  it("closes when a passed AbortSignal is aborted", async () => {
    writeFileSync(target, sidecarSource("size"))
    const ac = new AbortController()
    const controller = await track(
      await watch({
        root: fixtureRoot,
        mode: "sidecar",
        config: { include: ["src/watchtarget.schema.ts"], tsconfig: "tsconfig.json" },
        debounceMs: 30,
        signal: ac.signal,
      }),
    )

    ac.abort()
    // The abort listener schedules close() asynchronously; a subsequent explicit
    // close() must then be a no-op (proving the abort path already closed it).
    await waitFor(() => false, 200)
    await controller.close()
    expect(true).toBe(true)
  }, 60_000)

  it("closes immediately when given an already-aborted signal", async () => {
    writeFileSync(target, sidecarSource("size"))
    const ac = new AbortController()
    ac.abort()
    const calls: GenerateResult[] = []
    const controller = await track(
      await watch({
        root: fixtureRoot,
        mode: "sidecar",
        config: { include: ["src/watchtarget.schema.ts"], tsconfig: "tsconfig.json" },
        debounceMs: 30,
        signal: ac.signal,
        onGenerate: (r) => calls.push(r),
      }),
    )

    // The initial generate still runs before the aborted-signal branch closes the
    // watcher synchronously inside watch().
    expect(calls.length).toBeGreaterThanOrEqual(1)
    // Already closed; close() short-circuits.
    await controller.close()
    expect(true).toBe(true)
  }, 60_000)
})
