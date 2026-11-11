import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { generateJsonSchema } from "../src/index.ts"
import { afterAll, describe, expect, it } from "./test-api.ts"

// Runs the REAL isolated worker subprocess against the existing fixture schema module.
// The worker must import a `.ts` module that bare-imports `tskm`, so it needs a TS-capable
// runtime that can resolve the workspace `tskm`; this runtime (process.execPath) is passed
// explicitly as the worker exec path.
const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url))
const output = fileURLToPath(new URL("./fixtures/basic/src/account.schema.json", import.meta.url))
const noisySource = fileURLToPath(new URL("./fixtures/basic/src/noisy.schema.ts", import.meta.url))
const noisyOutput = fileURLToPath(
  new URL("./fixtures/basic/src/noisy.schema.json", import.meta.url),
)
const lossyRoot = fileURLToPath(new URL("./fixtures/json-lossy", import.meta.url))
const lossySource = fileURLToPath(
  new URL("./fixtures/json-lossy/src/lossy.schema.ts", import.meta.url),
)
const lossyOutput = fileURLToPath(
  new URL("./fixtures/json-lossy/src/lossy.schema.json", import.meta.url),
)

afterAll(() => {
  for (const f of [output, noisySource, noisyOutput, lossyOutput]) {
    if (existsSync(f)) rmSync(f)
  }
})

describe("generateJsonSchema — isolated subprocess (real import)", () => {
  it("walks the runtime schema objects into a JSON Schema file", async () => {
    const result = await generateJsonSchema({
      root: fixtureRoot,
      // `transform` output is not representable, so the file opts into the approximation.
      config: { include: ["src/account.schema.ts"], jsonSchema: { approximate: ["transform"] } },
      execPath: process.execPath,
    })

    expect(result.files).toHaveLength(1)
    expect(result.errors).toEqual([])
    expect(result.files[0]?.schemaNames).toEqual(
      expect.arrayContaining(["accountSchema", "tagSchema"]),
    )
    // The approximation is noted as a warning, attributed to the exported schema and its path.
    expect(result.diagnostics).toEqual([
      `tskm: ${resolve(fixtureRoot, "src/account.schema.ts")}: accountSchema.nameLength: approximated transform as the schema before the transform.`,
    ])

    const doc = JSON.parse(readFileSync(output, "utf8")) as {
      accountSchema: {
        type: string
        properties: Record<string, { type?: string; items?: { type?: string } }>
        required: string[]
        additionalProperties: boolean
      }
      tagSchema: { type: string }
    }

    const account = doc.accountSchema
    expect(account.type).toBe("object")
    expect(account.additionalProperties).toBe(false)
    expect(account.properties.id?.type).toBe("string")
    expect(account.properties.age?.type).toBe("number")
    expect(account.properties.roles?.type).toBe("array")
    expect(account.properties.roles?.items?.type).toBe("string")
    // `nickname` is optional → present in properties but excluded from required.
    expect(account.properties.nickname).toBeDefined()
    expect(account.required).not.toContain("nickname")
    expect(account.required).toEqual(expect.arrayContaining(["id", "age", "roles", "nameLength"]))

    expect(doc.tagSchema).toEqual({ type: "string" })
  }, 60_000)

  it("tolerates a schema module that writes to stdout (envelope is file-based)", async () => {
    // A stray console.log used to corrupt the stdout envelope; the worker now writes to a
    // file, so module output cannot break parsing.
    writeFileSync(
      noisySource,
      `import { object, string } from "@tskm/core"\nconsole.log("side effect on stdout")\nexport const noisySchema = object({ a: string() })\n`,
    )
    const result = await generateJsonSchema({
      root: fixtureRoot,
      config: { include: ["src/noisy.schema.ts"] },
      execPath: process.execPath,
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.files).toHaveLength(1)
    const doc = JSON.parse(readFileSync(noisyOutput, "utf8")) as {
      noisySchema: { type: string; properties: Record<string, { type?: string }> }
    }
    expect(doc.noisySchema.type).toBe("object")
    expect(doc.noisySchema.properties.a?.type).toBe("string")
  }, 60_000)
})

describe("generateJsonSchema — unrepresentable types fail closed (real import)", () => {
  // The lossy fixture holds bigint (a field and a tuple slot) and date. Its export is
  // `orderSchema`, so the diagnostic paths start with the document key.
  const lossyPrefix = `tskm: ${lossySource}: `

  it("fails the file by default: each path is named, the option is offered, nothing is written", async () => {
    rmSync(lossyOutput, { force: true })
    const result = await generateJsonSchema({
      root: lossyRoot,
      config: { include: ["src/lossy.schema.ts"] },
      execPath: process.execPath,
    })

    expect(result.files).toEqual([])
    expect(result.errors).toEqual([
      `${lossyPrefix}orderSchema.amount: cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation. Add "bigint" to jsonSchema.approximate (CLI: --approximate bigint) to emit it as a string instead.`,
      `${lossyPrefix}orderSchema.createdAt: cannot convert schema type "date" to JSON Schema: Date has no JSON representation. Add "date" to jsonSchema.approximate (CLI: --approximate date) to emit it as a date-time string instead.`,
      `${lossyPrefix}orderSchema.lines[0]: cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation. Add "bigint" to jsonSchema.approximate (CLI: --approximate bigint) to emit it as a string instead.`,
    ])
    // Every error is also a diagnostic line, so the CLI prints the same text.
    expect(result.diagnostics).toEqual(result.errors)
    expect(existsSync(lossyOutput)).toBe(false)
  }, 60_000)

  it("with the types listed in jsonSchema.approximate, writes the previous approximate output", async () => {
    rmSync(lossyOutput, { force: true })
    const result = await generateJsonSchema({
      root: lossyRoot,
      config: {
        include: ["src/lossy.schema.ts"],
        jsonSchema: { approximate: ["bigint", "date"] },
      },
      execPath: process.execPath,
    })

    expect(result.errors).toEqual([])
    expect(result.files).toHaveLength(1)
    expect(result.diagnostics).toEqual([
      `${lossyPrefix}orderSchema.amount: approximated bigint as a string.`,
      `${lossyPrefix}orderSchema.createdAt: approximated date as a date-time string.`,
      `${lossyPrefix}orderSchema.lines[0]: approximated bigint as a string.`,
    ])
    const doc = JSON.parse(readFileSync(lossyOutput, "utf8")) as {
      orderSchema: {
        properties: Record<string, unknown>
        required: string[]
      }
    }
    expect(doc.orderSchema.properties.amount).toEqual({ type: "string" })
    expect(doc.orderSchema.properties.createdAt).toEqual({
      type: "string",
      format: "date-time",
    })
    expect(doc.orderSchema.properties.lines).toEqual({
      type: "array",
      prefixItems: [{ type: "string" }],
      items: false,
    })
    expect(doc.orderSchema.required).toEqual(["id", "amount", "createdAt", "lines", "tags"])
  }, 60_000)

  it("applies the CLI-style jsonSchema override to the config loaded from the root", async () => {
    rmSync(lossyOutput, { force: true })
    // No config object, so the root's config is loaded (there is no tskm.config.* here, so the
    // defaults apply). The override is the only source of the approximation list.
    const result = await generateJsonSchema({
      root: lossyRoot,
      jsonSchema: { approximate: ["bigint", "date"] },
      execPath: process.execPath,
    })
    expect(result.errors).toEqual([])
    expect(result.files).toHaveLength(1)
  }, 60_000)
})
