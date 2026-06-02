import { defineConfig } from "rolldown"
import { dts } from "rolldown-plugin-dts"

// @tskm/compiler (workspace) and the vite peer dependency stay external.
export default defineConfig({
  input: "src/index.ts",
  platform: "node",
  external: [/^@tskm\/compiler/, /^vite$/, /^vite\//],
  plugins: [dts({ tsconfig: "tsconfig.json" })],
  output: {
    dir: "dist",
    format: "es",
    entryFileNames: "[name].mjs",
    chunkFileNames: "[name].mjs",
  },
})
