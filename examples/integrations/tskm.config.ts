import { defineConfig } from "@tskm/compiler"

/**
 * Static Standard JSON Schema literals in the sidecar. Off unless this is set.
 * `include` stops at `src/`, so a module under `shared/` or a framework directory
 * is not a schema source and generating the sidecar does not load it.
 */
export default defineConfig({
  include: ["src/**/*.ts"],
  jsonSchema: { emit: "standard" },
})
