import { defineConfig } from "rolldown"
import { dts } from "rolldown-plugin-dts"

// dependencies / peerDependencies (the @corsa-bind/napi native addon, oxc-parser, and the
// dynamically-resolved @typescript/native-preview tsgo binary) must stay external — unlike
// tsdown, rolldown bundles node_modules by default, so they are listed explicitly here.
export default defineConfig({
  // jsonschema-worker is a separate entry: generateJsonSchema spawns it as its own
  // process (resolved on disk), never imports it, so it must ship as a standalone file.
  input: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "jsonschema-worker": "src/jsonschema-worker.ts",
  },
  platform: "node",
  external: [/^@corsa-bind\/napi/, /^oxc-parser/, /^@typescript\/native-preview/],
  plugins: [dts({ tsconfig: "tsconfig.json" })],
  output: {
    dir: "dist",
    format: "es",
    entryFileNames: "[name].mjs",
    chunkFileNames: "[name].mjs",
  },
})
