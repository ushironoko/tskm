import { defineConfig } from "tsdown"

// dependencies / peerDependencies (incl. the @corsa-bind/napi native addon) are
// externalized by tsdown automatically — no need to list them.
export default defineConfig({
  // jsonschema-worker is a separate entry: generateJsonSchema spawns it as its own
  // process (resolved on disk), never imports it, so it must ship as a standalone file.
  entry: ["src/index.ts", "src/cli.ts", "src/jsonschema-worker.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
})
