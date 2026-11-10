import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generateJsonSchema } from "../src/index.ts"

// Vendor-dispatch JSON Schema generation through the REAL isolated worker:
// tskm walker / zod native (spec 1.1) / @valibot/to-json-schema / arktype
// native, all from ONE module. A vendor conversion failure fails its file.
const fixtureRoot = fileURLToPath(new URL("./fixtures/standard", import.meta.url))
const output = fileURLToPath(
  new URL("./fixtures/standard/src/json-mixed.schema.json", import.meta.url),
)
const badRoot = fileURLToPath(new URL("./fixtures/json-vendor-bad", import.meta.url))
const badSource = fileURLToPath(
  new URL("./fixtures/json-vendor-bad/src/vendor-bad.schema.ts", import.meta.url),
)
const badOutput = fileURLToPath(
  new URL("./fixtures/json-vendor-bad/src/vendor-bad.schema.json", import.meta.url),
)

function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

afterAll(() => {
  for (const file of [output, badOutput]) {
    if (existsSync(file)) rmSync(file)
  }
})

describe.skipIf(!bun)("generateJsonSchema — Standard Schema vendor dispatch (real worker)", () => {
  it("routes each vendor to its converter and merges one document", async () => {
    const result = await generateJsonSchema({
      root: fixtureRoot,
      config: { include: ["src/json-mixed.schema.ts"] },
      execPath: bun,
      timeoutMs: 30_000,
    })

    expect(result.errors).toEqual([])
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.schemaNames).toEqual(
      expect.arrayContaining(["coreSchema", "zodSchema", "valibotSchema", "arkSchema"]),
    )

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
  }, 60_000)

  it("excludes opted-out vendors from the document (schemaSources: []) with a per-vendor diagnostic", async () => {
    const result = await generateJsonSchema({
      root: fixtureRoot,
      config: { include: ["src/json-mixed.schema.ts"], schemaSources: [] },
      execPath: bun,
      timeoutMs: 30_000,
    })
    // only the tskm export survives
    expect(result.errors).toEqual([])
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

describe.skipIf(!bun)(
  "generateJsonSchema — a vendor conversion failure fails the file (real worker)",
  () => {
    beforeAll(() => {
      if (existsSync(badOutput)) rmSync(badOutput)
    })

    it("names each failing export, writes nothing, and reports every error", async () => {
      const result = await generateJsonSchema({
        root: badRoot,
        config: { include: ["src/vendor-bad.schema.ts"] },
        execPath: bun,
        timeoutMs: 30_000,
      })

      expect(result.files).toEqual([])
      expect(result.removed).toEqual([])
      expect(existsSync(badOutput)).toBe(false)
      // One error per failing export, prefixed with the export name, and none for the valid one.
      const names = result.errors.map(
        (line) => line.replace(`tskm: ${badSource}: `, "").split(":")[0],
      )
      expect(names).toEqual(
        expect.arrayContaining([
          "zodBigintSchema",
          "zodInfinitySchema",
          "valibotTransformSchema",
          "arktypeBigintSchema",
        ]),
      )
      expect(names).not.toContain("okSchema")
      expect(result.errors.every((line) => line.startsWith(`tskm: ${badSource}: `))).toBe(true)
      expect(result.errors.join("\n")).toContain("Infinity has no JSON representation")
      expect(result.errors.join("\n")).toContain("Vendor schemas have no approximation")
      // Errors are also diagnostic lines, so the CLI prints the same text.
      expect(result.diagnostics).toEqual(expect.arrayContaining(result.errors))
    }, 60_000)

    it("deletes the previous output of the failing source", async () => {
      // A stale document from an earlier, passing run.
      writeFileSync(badOutput, '{"okSchema":{"type":"object"}}\n')
      const result = await generateJsonSchema({
        root: badRoot,
        config: { include: ["src/vendor-bad.schema.ts"] },
        execPath: bun,
        timeoutMs: 30_000,
      })

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.removed).toEqual([badOutput])
      expect(existsSync(badOutput)).toBe(false)
    }, 60_000)
  },
)
