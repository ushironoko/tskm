/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  testRunner: "tskm-bun",
  plugins: ["../../tools/stryker-bun-runner/index.mjs"],
  coverageAnalysis: "perTest",
  // No incremental mode: the gated score must come from a full run. Incremental
  // was verified to misattribute coverage with the previous community runner and
  // has not been re-validated against the in-repo runner (tools/stryker-bun-runner).
  // The json report is the machine-readable record for CI artifacts.
  reporters: ["clear-text", "progress", "json"],
  thresholds: { high: 90, low: 80, break: 80 },
  mutate: ["src/**/*.ts"],
  // The real-vite/real-tsgo integration test stays in `bun test`. It is not
  // copied into the Stryker sandbox: each covering mutant re-runs it, and that
  // dominated the vite mutation job (about 14s, almost all of it this file).
  ignorePatterns: ["test/dev-server.integration.test.ts"],
}
