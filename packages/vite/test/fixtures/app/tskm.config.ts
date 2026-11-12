import { defineConfig } from "@tskm/compiler"

/**
 * Static Standard JSON Schema literals in the sidecar.
 * `include` stops at `src/`, so `static-entry.ts` is not a schema source and
 * generating the sidecar does not load it.
 */
export default defineConfig({
  include: ["src/**/*.ts"],
  jsonSchema: { emit: "standard" },
})
