import { describe, expect, it } from "bun:test"
import {
  type BundleMeasure,
  measureStaticJsonSchemaBundles,
  renderSizeReport,
} from "../../../bench/json-schema-static-size.ts"

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

describe("renderSizeReport", () => {
  const rows: BundleMeasure[] = [
    { label: "source static", minifyBytes: 1000, gzipBytes: 400, containsConvert: false },
    { label: "source runtime", minifyBytes: 1800, gzipBytes: 700, containsConvert: true },
  ]

  it("renders a markdown table row per measure with a yes/no convert column", () => {
    const report = renderSizeReport(rows)
    expect(report).toContain("| entry | minify bytes | gzip bytes | contains `convert.ts` |")
    expect(report).toContain("| source static | 1000 | 400 | no |")
    expect(report).toContain("| source runtime | 1800 | 700 | yes |")
  })

  it("reports the runtime − static gzip delta when both source rows are present", () => {
    // 700 (runtime) − 400 (static) = 300.
    expect(renderSizeReport(rows)).toContain("Source gzip delta (runtime − static): 300 bytes.")
  })

  it("omits the delta line when a source row is missing", () => {
    const partial: BundleMeasure[] = [
      { label: "dist static", minifyBytes: 900, gzipBytes: 380, containsConvert: false },
    ]
    const report = renderSizeReport(partial)
    expect(report).not.toContain("Source gzip delta")
    // The table and the invariant note are still emitted.
    expect(report).toContain("| dist static | 900 | 380 | no |")
    expect(report).toContain("must not contain `src/json-schema/convert.ts`")
  })
})
