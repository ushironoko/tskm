import { describe, expect, it } from "bun:test"
import { measureStaticJsonSchemaBundles } from "../../../bench/json-schema-static-size.ts"

describe("static JSON Schema bundle", () => {
  it("does not include the runtime walker after esbuild minify", async () => {
    const rows = await measureStaticJsonSchemaBundles()
    const staticRows = rows.filter((row) => row.label.endsWith("static"))
    const runtimeRows = rows.filter((row) => row.label.endsWith("runtime"))
    expect(staticRows.length).toBeGreaterThan(0)
    expect(runtimeRows.length).toBeGreaterThan(0)
    for (const row of staticRows) {
      expect(row.containsConvert).toBe(false)
    }
    for (const row of runtimeRows) {
      expect(row.containsConvert).toBe(true)
      const matching = staticRows.find(
        (item) => item.label.split(" ")[0] === row.label.split(" ")[0],
      )
      if (matching) {
        expect(matching.gzipBytes).toBeLessThan(row.gzipBytes)
      }
    }
  }, 30_000)
})
