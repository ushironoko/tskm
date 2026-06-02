import { defineConfig } from "tsdown"

// dependencies / peerDependencies (incl. the @corsa-bind/napi native addon) are
// externalized by tsdown automatically — no need to list them.
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
})
