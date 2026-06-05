import { defineConfig } from "rolldown"
import { dts } from "rolldown-plugin-dts"

// dependencies / peerDependencies (the @corsa-bind/napi native addon, oxc-parser, and the
// dynamically-resolved @typescript/native-preview tsgo binary) must stay external — unlike
// tsdown, rolldown bundles node_modules by default, so they are listed explicitly here.
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
    /^@corsa-bind\/napi/,
    /^oxc-parser/,
    /^@typescript\/native-preview/,
    /^zod$/,
    /^zod\//,
    /^valibot$/,
    /^@valibot\/to-json-schema$/,
    /^arktype$/,
  ],
  plugins: [dts({ tsconfig: "tsconfig.json" })],
  output: {
    dir: "dist",
    format: "es",
    entryFileNames: "[name].mjs",
    chunkFileNames: "[name].mjs",
  },
})
