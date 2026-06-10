// Bun test preload for the in-repo Stryker runner (see index.mjs).
//
// Per-test coverage attribution works by sequence number, not test name:
// bun 1.3.13 does not implement expect.getState().currentTestName, so the
// runner pairs `t<N>` keys with the N-th executed (non-skipped) testcase in
// the JUnit report, whose document order is the execution order.
//
// The global afterAll fires once after ALL files (verified on bun 1.3.13) but
// does NOT fire under --bail, and process.on("exit") never fires under bun
// test — so the runner treats the out-file as best-effort and unlinks stale
// copies before each spawn.
import { afterAll, afterEach, beforeEach } from "bun:test"
import { writeFileSync } from "node:fs"

if (!globalThis.__stryker__) {
  globalThis.__stryker__ = {}
}
const ns = globalThis.__stryker__

const hitLimit = process.env.__STRYKER_HIT_LIMIT__
if (hitLimit) {
  ns.hitLimit = Number(hitLimit)
  ns.hitCount = 0
}

let executed = 0
beforeEach(() => {
  ns.currentTestId = `t${executed++}`
})
afterEach(() => {
  ns.currentTestId = undefined
})

const outFile = process.env.__STRYKER_OUT_FILE__
if (outFile) {
  afterAll(() => {
    writeFileSync(
      outFile,
      JSON.stringify({
        executedTests: executed,
        hitCount: ns.hitCount,
        mutantCoverage: ns.mutantCoverage ?? null,
      }),
    )
  })
}
