import { describe, expect, it } from "bun:test"
import { type } from "arktype"
import * as v from "valibot"
import { z } from "zod"
import { schemaToJsonSchemaViaAdapter } from "../src/jsonschema-adapter.ts"

const ALL = new Set(["tskm", "zod", "valibot", "arktype"])
const ctx = (over: Partial<Parameters<typeof schemaToJsonSchemaViaAdapter>[1]> = {}) => ({
  io: "output" as const,
  allowedVendors: ALL,
  ...over,
})

describe("schemaToJsonSchemaViaAdapter — vendor dispatch (real libraries)", () => {
  it("converts a zod schema through z.toJSONSchema", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      z.object({ name: z.string(), age: z.number().optional() }),
      ctx(),
    )
    expect(outcome.kind).toBe("converted")
    if (outcome.kind !== "converted") return
    expect(outcome.schema.type).toBe("object")
    expect(outcome.schema.required).toEqual(["name"])
  })

  it("converts a valibot schema through @valibot/to-json-schema", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      v.object({ name: v.string(), age: v.optional(v.number()) }),
      ctx(),
    )
    expect(outcome.kind).toBe("converted")
    if (outcome.kind !== "converted") return
    expect(outcome.schema.type).toBe("object")
    expect(outcome.schema.required).toEqual(["name"])
  })

  it("converts an arktype schema through the spec 1.1 native converter", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(type({ name: "string" }), ctx())
    expect(outcome.kind).toBe("converted")
    if (outcome.kind !== "converted") return
    expect(outcome.schema.type).toBe("object")
    expect(outcome.schema.properties).toEqual({ name: { type: "string" } })
  })

  it("routes a tskm-shaped value to the native walker", async () => {
    // Duck-typed tskm schema (string), same as jsonschema.test.ts builds.
    const tskmString = { kind: "schema", type: "string" }
    const outcome = await schemaToJsonSchemaViaAdapter(tskmString, ctx())
    expect(outcome.kind).toBe("converted")
    if (outcome.kind !== "converted") return
    expect(outcome.schema).toEqual({ type: "string" })
  })
})

describe("schemaToJsonSchemaViaAdapter — skip and exclusion policies", () => {
  it("skips a zod schema with an unrepresentable type, with the reason", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(z.bigint(), ctx())
    expect(outcome.kind).toBe("skipped")
    if (outcome.kind !== "skipped") return
    expect(outcome.reason).toContain("rejected the schema")
  })

  it("skips a valibot transform pipe (not representable), with the reason", async () => {
    const piped = v.pipe(
      v.string(),
      v.transform((s) => s.length),
    )
    const outcome = await schemaToJsonSchemaViaAdapter(piped, ctx())
    expect(outcome.kind).toBe("skipped")
    if (outcome.kind !== "skipped") return
    expect(outcome.reason).toContain("@valibot/to-json-schema rejected")
  })

  it("skips with install guidance when @valibot/to-json-schema is missing (DI seam)", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      v.object({ a: v.string() }),
      ctx({
        importModule: (specifier) =>
          specifier === "@valibot/to-json-schema"
            ? Promise.reject(new Error("Cannot find package"))
            : import(specifier),
      }),
    )
    expect(outcome.kind).toBe("skipped")
    if (outcome.kind !== "skipped") return
    expect(outcome.reason).toContain("@valibot/to-json-schema")
    expect(outcome.reason).toContain("bun add")
  })

  it("excludes a vendor outside the allow-list, naming the runtime vendor", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      z.object({ a: z.string() }),
      ctx({ allowedVendors: new Set(["tskm"]) }),
    )
    // The vendor travels with the outcome so the parent can aggregate a
    // diagnostic instead of dropping the schema without feedback.
    expect(outcome).toEqual({ kind: "excluded", vendor: "zod" })
  })

  it("skips a non-Standard-Schema value with a reason", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter({ plain: true }, ctx())
    expect(outcome.kind).toBe("skipped")
  })

  it("skips an allowed vendor that has no converter", async () => {
    const fake = {
      "~standard": { version: 1, vendor: "mystery", validate: () => ({ value: 1 }) },
    }
    const outcome = await schemaToJsonSchemaViaAdapter(
      fake,
      ctx({ allowedVendors: new Set(["tskm", "mystery"]) }),
    )
    expect(outcome.kind).toBe("skipped")
    if (outcome.kind !== "skipped") return
    expect(outcome.reason).toContain("mystery")
  })
})

describe("schemaToJsonSchemaViaAdapter — zod vendor fallback (no native ~standard.jsonSchema)", () => {
  // Modern zod schemas carry a spec-1.1 `~standard.jsonSchema` method and take the native
  // path. These cases pin the SEPARATE `z.toJSONSchema` fallback used when that method is
  // absent (older zod), via a fake zod-vendor value with no native converter plus the
  // `importModule` DI seam standing in for the user's project `zod`.
  const zodVendorValue = {
    "~standard": { version: 1, vendor: "zod", validate: () => ({ value: {} }) },
  }

  it("converts via z.toJSONSchema, forwarding io and unrepresentable:'throw'", async () => {
    let seenArgs: { io?: string; unrepresentable?: string } | undefined
    const outcome = await schemaToJsonSchemaViaAdapter(
      zodVendorValue,
      ctx({
        io: "input",
        importModule: (specifier) =>
          specifier === "zod"
            ? Promise.resolve({
                z: {
                  toJSONSchema: (
                    _value: unknown,
                    opts: { io: string; unrepresentable: string },
                  ) => {
                    seenArgs = opts
                    return { type: "string" }
                  },
                },
              })
            : import(specifier),
      }),
    )
    expect(outcome.kind).toBe("converted")
    if (outcome.kind !== "converted") return
    expect(outcome.schema).toEqual({ type: "string" })
    // The adapter must honor the requested io side and force unrepresentable types to
    // throw (so they collapse to a `skipped`, never a silently-lossy schema).
    expect(seenArgs).toEqual({ io: "input", unrepresentable: "throw" })
  })

  it("skips with a project-import message when zod cannot be imported", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      zodVendorValue,
      ctx({
        importModule: (specifier) =>
          specifier === "zod"
            ? Promise.reject(new Error("Cannot find package 'zod'"))
            : import(specifier),
      }),
    )
    expect(outcome.kind).toBe("skipped")
    if (outcome.kind !== "skipped") return
    expect(outcome.reason).toBe('could not import "zod" from the project')
  })

  it("skips with the converter's reason when z.toJSONSchema rejects the schema", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      zodVendorValue,
      ctx({
        importModule: (specifier) =>
          specifier === "zod"
            ? Promise.resolve({
                z: {
                  toJSONSchema: () => {
                    throw new Error("unrepresentable type")
                  },
                },
              })
            : import(specifier),
      }),
    )
    expect(outcome.kind).toBe("skipped")
    if (outcome.kind !== "skipped") return
    expect(outcome.reason).toContain("z.toJSONSchema rejected the schema")
    expect(outcome.reason).toContain("unrepresentable type")
  })
})
