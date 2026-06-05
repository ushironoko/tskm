import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generateJsonSchema } from "../src/index.ts"

// Vendor-dispatch JSON Schema generation through the REAL isolated worker:
// tskm walker / zod native (spec 1.1) / @valibot/to-json-schema / arktype
// native, all from ONE module, plus the unrepresentable-skip policy.
const fixtureRoot = fileURLToPath(new URL("./fixtures/standard", import.meta.url))
const output = fileURLToPath(
  new URL("./fixtures/standard/src/json-mixed.schema.json", import.meta.url),
)

function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

afterAll(() => {
  if (existsSync(output)) rmSync(output)
})

describe.skipIf(!bun)("generateJsonSchema — Standard Schema vendor dispatch (real worker)", () => {
  it("routes each vendor to its converter and merges one document", async () => {
    const result = await generateJsonSchema({
      root: fixtureRoot,
      config: { include: ["src/json-mixed.schema.ts"] },
      execPath: bun,
      timeoutMs: 30_000,
    })

    expect(result.files).toHaveLength(1)
    const names = result.files[0]?.schemaNames ?? []
    expect(names).toEqual(
      expect.arrayContaining(["coreSchema", "zodSchema", "valibotSchema", "arkSchema"]),
    )
    // the unrepresentable bigint is NOT in the document...
    expect(names).not.toContain("bigSchema")
    // ...but its skip reason IS surfaced
    expect(result.diagnostics.some((d) => d.includes("bigSchema"))).toBe(true)
    expect(result.diagnostics.some((d) => d.includes("rejected the schema"))).toBe(true)

    const doc = JSON.parse(readFileSync(output, "utf8")) as Record<
      string,
      { type?: string; properties?: Record<string, { type?: string }>; required?: string[] }
    >
    // tskm walker output
    expect(doc.coreSchema?.type).toBe("object")
    expect(doc.coreSchema?.properties?.id).toEqual({ type: "string" })
    // zod native (spec 1.1) output
    expect(doc.zodSchema?.type).toBe("object")
    expect(doc.zodSchema?.required).toEqual(["label"])
    // valibot via @valibot/to-json-schema
    expect(doc.valibotSchema?.type).toBe("object")
    expect(doc.valibotSchema?.properties?.name).toEqual({ type: "string" })
    // arktype native (spec 1.1) output
    expect(doc.arkSchema?.type).toBe("object")
    expect(doc.arkSchema?.properties?.flag).toEqual({ type: "boolean" })
    expect(doc.bigSchema).toBeUndefined()
  }, 60_000)

  it("excludes opted-out vendors from the document (schemaSources: []) with a per-vendor diagnostic", async () => {
    const result = await generateJsonSchema({
      root: fixtureRoot,
      config: { include: ["src/json-mixed.schema.ts"], schemaSources: [] },
      execPath: bun,
      timeoutMs: 30_000,
    })
    // only the tskm export survives
    expect(result.files[0]?.schemaNames).toEqual(["coreSchema"])
    const doc = JSON.parse(readFileSync(output, "utf8")) as Record<string, unknown>
    expect(Object.keys(doc)).toEqual(["coreSchema"])
    // exclusion is no longer silent: one aggregated diagnostic per (file, vendor),
    // naming the runtime vendor and the allow-list — this is what surfaces a
    // vendor-string/package-root mismatch instead of swallowing it
    const text = result.diagnostics.join("\n")
    for (const vendor of ["zod", "valibot", "arktype"]) {
      expect(text).toContain(`vendor "${vendor}"`)
    }
    expect(text).toContain("schemaSources")
    // aggregated, not one line per export: exactly one diagnostic per vendor
    expect(result.diagnostics.filter((d) => d.includes('vendor "zod"'))).toHaveLength(1)
  }, 60_000)
})
