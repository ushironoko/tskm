import { defineConfig } from "rolldown"
import { dts } from "rolldown-plugin-dts"

// minify stays off so the quoted Standard-Schema keys ("~standard" etc.) are never mangled
export default defineConfig({
  input: "src/index.ts",
  // pure library: no Node/browser globals, so emit platform-neutral output
  platform: "neutral",
  plugins: [dts({ tsconfig: "tsconfig.json" })],
  output: {
    dir: "dist",
    format: "es",
    entryFileNames: "[name].mjs",
    chunkFileNames: "[name].mjs",
    minify: false,
  },
})
