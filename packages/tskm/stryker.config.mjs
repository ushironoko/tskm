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
  mutate: [
    "src/**/*.ts",
    // Type-only modules: erased at runtime, so they yield no meaningful mutants
    // (src/types/config.ts stays in scope — it carries runtime defaults).
    "!src/types/dataset.ts",
    "!src/types/infer.ts",
    "!src/types/issue.ts",
    "!src/types/schema.ts",
    "!src/types/standard.ts",
  ],
}
