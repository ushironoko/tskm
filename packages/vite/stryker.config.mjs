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
  mutate: ["src/**/*.ts"],
}
