import { afterAll, describe, expect, it } from "bun:test"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"

// A throwaway schema written INTO the fixture's `src/` (so it sits under the tsconfig
// include) carrying a first-run `Infer` marker for inplace to convert.
const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url))
const source = fileURLToPath(new URL("./fixtures/basic/src/widget.schema.ts", import.meta.url))
const query = fileURLToPath(
  new URL("./fixtures/basic/src/widget.schema.tskm-query.ts", import.meta.url),
)

const SOURCE = `import { object, string, number, type Infer } from "@tskm/core"

export const widgetSchema = object({
  id: string(),
  size: number(),
})

export type Widget = Infer<typeof widgetSchema>
`

afterAll(() => {
  for (const f of [source, query]) {
    if (existsSync(f)) rmSync(f)
  }
})

describe("compiler generate — inplace mode (real tsgo)", () => {
  it("converts an Infer marker into a fenced sentinel block carrying the concrete type", async () => {
    writeFileSync(source, SOURCE)
    const result = await generate({
      root: fixtureRoot,
      mode: "inplace",
      config: { include: ["src/widget.schema.ts"], tsconfig: "tsconfig.json" },
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.mode).toBe("inplace")
    expect(result.files[0]?.changed).toBe(true)

    const written = readFileSync(source, "utf8")
    expect(written).toMatch(/\/\/ @tskm-gen Widget from widgetSchema #[0-9a-f]{8}/)
    expect(written).toContain("export type Widget = {")
    expect(written).toContain("id: string")
    expect(written).toContain("size: number")
    expect(written).toContain("// @tskm-end Widget")
    // The schema declaration itself is preserved verbatim.
    expect(written).toContain("export const widgetSchema = object({")
  }, 60_000)

  it("is idempotent: a second run reports no change and leaves the file untouched", async () => {
    const before = readFileSync(source, "utf8")
    const result = await generate({
      root: fixtureRoot,
      mode: "inplace",
      config: { include: ["src/widget.schema.ts"], tsconfig: "tsconfig.json" },
    })
    expect(result.files[0]?.changed).toBe(false)
    expect(readFileSync(source, "utf8")).toBe(before)
  }, 60_000)

  it("leaves no query files behind", () => {
    expect(existsSync(query)).toBe(false)
  })
})
