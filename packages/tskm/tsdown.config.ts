import { defineConfig } from "tsdown"

// minify stays off so the quoted Standard-Schema keys ("~standard" etc.) are never mangled
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  treeshake: true,
})
