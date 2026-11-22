import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import type { GenerateResult } from "../src/index.ts"
import * as compiler from "../src/index.ts"
import { registerSuite } from "./runners/suite.ts"
import { fixture } from "./scenarios/support.ts"
import { watchSuites } from "./scenarios/watch.ts"
import { afterEach, describe, expect, it } from "./test-api.ts"
import { withTestTsgo } from "./tsgo-test-executable.ts"

// The watch runtime (fs.watch, debounce, abort) against the real checker, on both runtimes.
// The scenarios live in scenarios/watch.ts.
for (const suite of watchSuites(compiler)) {
  registerSuite(suite)
}

// Direct integration tests that drive the real watch() controller against a temp fixture and
// assert on the onGenerate payload. These exercise the in-process runtime branches of watch()
// — the fsWatch callback's filters + debounce timer, and flush()'s full / incremental / empty
// plans — which the pure planWatchActions unit tests (watch.test.ts) cannot reach.

const intRoot = fixture("basic")
const intTarget = fixture("basic/src/watchint.schema.ts")
const intSidecar = fixture("basic/src/watchint.schema.gen.ts")
const intQuery = fixture("basic/src/watchint.schema.tskm-query.ts")
const intNonTs = fixture("basic/src/watchint.notes.txt")
const tsconfigPath = fixture("basic/tsconfig.json")

function intConfig() {
  return withTestTsgo({ include: ["src/watchint.schema.ts"], tsconfig: "tsconfig.json" })
}

/** A @tskm/core schema whose numeric field name varies, so each rewrite is a real content change. */
function intSource(field: string): string {
  return `import { object, string, number } from "@tskm/core"

export const watchIntSchema = object({
  id: string(),
  ${field}: number(),
})
`
}

function cleanupInt(): void {
  for (const f of [
    intTarget,
    intSidecar,
    intQuery,
    intNonTs,
    fixture("basic/src/watchint.sibling.ts"),
  ]) {
    if (existsSync(f)) rmSync(f)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Resolves once `calls.length` grows past `before`, re-running `rewrite` on each poll tick so a
 * coalesced or dropped fs event is retried instead of awaited. Returns whether a new call landed.
 */
async function waitForCall(
  calls: ReadonlyArray<GenerateResult>,
  before: number,
  rewrite: (toggle: boolean) => void,
  budgetMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  let toggle = false
  while (Date.now() < deadline) {
    if (calls.length > before) return true
    toggle = !toggle
    rewrite(toggle)
    await sleep(40)
  }
  return calls.length > before
}

describe("compiler watch — onGenerate runtime", () => {
  afterEach(() => {
    cleanupInt()
    // Leave the shared fixture's tsconfig exactly as it was found.
  })

  it("re-generates a changed known source incrementally (plan.files branch)", async () => {
    writeFileSync(intTarget, intSource("size"))
    const calls: GenerateResult[] = []
    const controller = await compiler.watch({
      root: intRoot,
      mode: "sidecar",
      config: intConfig(),
      debounceMs: 20,
      onGenerate: (r) => calls.push(r),
    })
    try {
      // The initial full generate runs synchronously inside watch() before it resolves.
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0]?.files.length).toBe(1)
      expect(calls[0]?.files[0]?.mode).toBe("sidecar")
      expect(calls[0]?.files[0]?.source).toBe(intTarget)
      expect(existsSync(intSidecar)).toBe(true)

      const before = calls.length
      // Two synchronous writes per tick: both fs events fall inside the 20ms debounce window, so
      // the second clears the first's pending timer (the fsWatch `if (timer) clearTimeout` path),
      // and the coalesced flush runs planWatchActions → generateFile → mergeResults once.
      const fired = await waitForCall(calls, before, (toggle) => {
        writeFileSync(intTarget, intSource(toggle ? "a0" : "b0"))
        writeFileSync(intTarget, intSource(toggle ? "weight" : "height"))
      })
      expect(fired).toBe(true)
      const latest = calls[calls.length - 1]
      // The incremental pass forwards exactly the one regenerated file for the changed source.
      expect(latest?.files.length).toBe(1)
      expect(latest?.files[0]?.source).toBe(intTarget)
      expect(latest?.files[0]?.mode).toBe("sidecar")
    } finally {
      await controller.close()
    }
  }, 60_000)

  it("re-runs a full rebuild when the tsconfig changes (plan.full branch)", async () => {
    writeFileSync(intTarget, intSource("size"))
    const original = readFileSync(tsconfigPath, "utf8")
    const calls: GenerateResult[] = []
    const controller = await compiler.watch({
      root: intRoot,
      mode: "sidecar",
      config: intConfig(),
      debounceMs: 30,
      onGenerate: (r) => calls.push(r),
    })
    try {
      expect(calls.length).toBeGreaterThanOrEqual(1)
      const before = calls.length
      // Rewriting the tsconfig with identical bytes still delivers a change event. The planner
      // routes a tsconfig event to a full rebuild regardless of content, so flush() calls
      // session.generateAll and forwards the whole-project result. Identical bytes keep the
      // shared fixture untouched.
      const fired = await waitForCall(calls, before, () => {
        writeFileSync(tsconfigPath, original)
      })
      expect(fired).toBe(true)
      const latest = calls[calls.length - 1]
      // A full rebuild regenerates every included source; the watched target is among them.
      expect(latest?.files.some((f) => f.source === intTarget)).toBe(true)
    } finally {
      await controller.close()
      // Restore the fixture tsconfig verbatim (identical content, but be explicit).
      writeFileSync(tsconfigPath, original)
    }
  }, 60_000)

  it("ignores a non-.ts file and a generated artifact (fsWatch filters, no onGenerate)", async () => {
    writeFileSync(intTarget, intSource("size"))
    const calls: GenerateResult[] = []
    const controller = await compiler.watch({
      root: intRoot,
      mode: "sidecar",
      config: intConfig(),
      debounceMs: 20,
      onGenerate: (r) => calls.push(r),
    })
    try {
      expect(calls.length).toBeGreaterThanOrEqual(1)
      const before = calls.length
      // A plain .txt (not .ts, not the tsconfig) hits the extension gate in the fsWatch callback
      // and returns before the debounce timer. A `.schema.json` is one of the compiler's own
      // artifacts and is dropped by the generated-artifact gate. Neither may reach flush, so no
      // further onGenerate fires. Write repeatedly over an observation window to maximise event
      // delivery, then let any debounce window drain.
      for (let i = 0; i < 12; i++) {
        writeFileSync(intNonTs, `note ${i}\n`)
        writeFileSync(fixture(`basic/src/watchint.decoy.schema.json`), `{"n":${i}}\n`)
        await sleep(40)
      }
      await sleep(120)
      expect(calls.length).toBe(before)
    } finally {
      await controller.close()
      const decoy = fixture("basic/src/watchint.decoy.schema.json")
      if (existsSync(decoy)) rmSync(decoy)
    }
  }, 60_000)

  it("coalesces two fs events inside one debounce window into a single flush (timer reset)", async () => {
    writeFileSync(intTarget, intSource("size"))
    const sibling = fixture("basic/src/watchint.sibling.ts")
    const calls: GenerateResult[] = []
    const controller = await compiler.watch({
      root: intRoot,
      mode: "sidecar",
      config: intConfig(),
      debounceMs: 20,
      onGenerate: (r) => calls.push(r),
    })
    try {
      expect(calls.length).toBeGreaterThanOrEqual(1)
      const before = calls.length
      // Two writes to DISTINCT .ts paths in the same tick produce two separate inotify events
      // (unlike two writes to one path, which Linux coalesces). Both arrive inside the 20ms
      // debounce window, so the second event finds a pending timer and clears it before
      // rescheduling (the fsWatch `if (timer) clearTimeout(timer)` branch). The sibling is a .ts
      // outside the include set, so the coalesced plan is a full rebuild — one flush, one call.
      const fired = await waitForCall(
        calls,
        before,
        (toggle) => {
          writeFileSync(intTarget, intSource(toggle ? "weight" : "height"))
          writeFileSync(sibling, `export const marker${toggle ? 1 : 0} = 1\n`)
        },
        10_000,
      )
      expect(fired).toBe(true)
      // A full rebuild regenerated the included target.
      const latest = calls[calls.length - 1]
      expect(latest?.files.some((f) => f.source === intTarget)).toBe(true)
    } finally {
      await controller.close()
      if (existsSync(sibling)) rmSync(sibling)
    }
  }, 60_000)

  it("re-writing identical bytes to a known source does not regenerate (empty-plan early return)", async () => {
    const content = intSource("size")
    writeFileSync(intTarget, content)
    const calls: GenerateResult[] = []
    const controller = await compiler.watch({
      root: intRoot,
      mode: "sidecar",
      config: intConfig(),
      debounceMs: 20,
      onGenerate: (r) => calls.push(r),
    })
    try {
      expect(calls.length).toBeGreaterThanOrEqual(1)
      const before = calls.length
      // After the initial generate the source's output matches its content, so session.isCurrent
      // is true. Re-writing the SAME bytes delivers change events that pass the fsWatch .ts gate
      // and reach flush, but planWatchActions drops them (current content, not a change). The
      // resulting plan has no files and is not full, so flush() hits the empty-plan early return
      // and no onGenerate fires. Several rewrites over a window make the absence meaningful.
      for (let i = 0; i < 12; i++) {
        writeFileSync(intTarget, content)
        await sleep(40)
      }
      await sleep(150)
      expect(calls.length).toBe(before)
    } finally {
      await controller.close()
    }
  }, 60_000)
})
