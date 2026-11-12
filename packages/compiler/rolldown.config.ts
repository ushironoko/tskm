import { defineConfig } from "rolldown"
import { dts } from "rolldown-plugin-dts"

// dependencies / peerDependencies (oxc-parser, and the typescript package that provides
// typescript/sync plus the native checker) must stay external — unlike tsdown, rolldown
// bundles node_modules by default, so they are listed explicitly here.
export default defineConfig({
  // The workers are separate entries: the compiler spawns them as their own
  // processes (resolved on disk), never imports them, so they must ship as
  // standalone files.
  input: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "jsonschema-worker": "src/jsonschema-worker.ts",
    "structural-ts-worker": "src/structural-ts-worker.ts",
  },
  platform: "node",
  // zod/valibot/@valibot-to-json-schema are referenced ONLY through the JSON
  // Schema adapter's dynamic imports, resolved from the USER's node_modules at
  // runtime — they must never be bundled (they are not even dependencies).
  external: [
    /^typescript($|\/)/,
    /^bun:/,
    /^oxc-parser/,
    /^zod$/,
    /^zod\//,
    /^valibot$/,
    /^@valibot\/to-json-schema$/,
    /^arktype$/,
    // Static emit calls `@tskm/core/json-schema` from the worker at runtime.
    // The walker must stay in the user's install, not inside this bundle.
    /^@tskm\/core($|\/)/,
  ],
  plugins: [dts({ tsconfig: "tsconfig.json" })],
  output: {
    dir: "dist",
    format: "es",
    entryFileNames: "[name].mjs",
    chunkFileNames: "[name].mjs",
  },
})
