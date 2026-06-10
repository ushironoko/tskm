/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  testRunner: "bun",
  plugins: ["@hughescr/stryker-bun-runner"],
  coverageAnalysis: "perTest",
  // No incremental mode: with the bun runner it misattributes per-test coverage
  // across runs (newly added tests never re-test survived mutants, and re-runs can
  // flip previously-killed mutants back to survived), so a gated score must come
  // from a full run. The json report is the machine-readable record for CI artifacts.
  reporters: ["clear-text", "progress", "json"],
  thresholds: { high: 90, low: 80, break: 80 },
  // Integration fixtures resolve @tskm/core via tsconfig paths relative to the real
  // repo layout (../../../../tskm/...). A copy sandbox sits two directories deeper,
  // breaking that resolution, so instrument in place instead (Stryker backs up and
  // restores the originals).
  inPlace: true,
  mutate: [
    "src/**/*.ts",
    // The bun runner eager-imports every mutated module before tests run (dryRun
    // coverage pass). These entries execute at import time, so importing them
    // outside their real process would run them with bogus argv:
    // - cli.ts calls main() at top level
    // - the *-worker.ts files read process.argv and top-level await their protocol loop
    "!src/cli.ts",
    "!src/jsonschema-worker.ts",
    "!src/structural-ts-worker.ts",
  ],
  bun: {
    // Integration tests spawn real tsgo; the runner's 10s per-test default would
    // mark slow-but-passing mutant runs as TimedOut (counted as killed), inflating the score.
    timeout: 60000,
  },
}
