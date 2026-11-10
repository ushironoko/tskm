import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
  it("converts a zod schema through zod's native converter", async () => {
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

describe("schemaToJsonSchemaViaAdapter — tskm unrepresentable types", () => {
  const bigintField = {
    kind: "schema",
    type: "object",
    entries: { amount: { kind: "schema", type: "bigint" } },
    rest: "strip",
  }

  it("rejects a tskm schema the walker cannot represent, with the path and option", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(bigintField, ctx({ rootName: "Order" }))
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") return
    expect(outcome.errors).toEqual([
      'Order.amount: cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation. Add "bigint" to jsonSchema.approximate (CLI: --approximate bigint) to emit it as a string instead.',
    ])
  })

  it("converts the same schema once its type is listed in approximate", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      bigintField,
      ctx({ rootName: "Order", approximate: ["bigint"] }),
    )
    expect(outcome.kind).toBe("converted")
    if (outcome.kind !== "converted") return
    expect(outcome.schema).toEqual({
      type: "object",
      properties: { amount: { type: "string" } },
      required: ["amount"],
      additionalProperties: false,
    })
    expect(outcome.warnings).toEqual(["Order.amount: approximated bigint as a string."])
  })

  it("forwards io to the tskm walker: the input side of a preprocess is {}", async () => {
    const preprocessed = {
      kind: "schema",
      type: "preprocess",
      wrapped: { kind: "schema", type: "number" },
    }
    const input = await schemaToJsonSchemaViaAdapter(preprocessed, ctx({ io: "input" }))
    expect(input.kind).toBe("converted")
    if (input.kind !== "converted") return
    expect(input.schema).toEqual({})
  })
})

describe("schemaToJsonSchemaViaAdapter — a vendor conversion failure is rejected, never skipped", () => {
  const VENDOR_SUFFIX = "Vendor schemas have no approximation"

  it("rejects a zod schema with an unrepresentable type, naming the export and the vendor", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(z.bigint(), ctx({ rootName: "Amount" }))
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") return
    expect(outcome.errors).toHaveLength(1)
    expect(outcome.errors[0]).toStartWith("Amount: cannot convert zod schema to JSON Schema: ")
    expect(outcome.errors[0]).toContain("BigInt cannot be represented")
    expect(outcome.errors[0]).toContain(VENDOR_SUFFIX)
  })

  it("rejects a valibot transform pipe on the output side, with the converter's reason", async () => {
    const piped = v.pipe(
      v.string(),
      v.transform((s) => s.length),
    )
    const outcome = await schemaToJsonSchemaViaAdapter(piped, ctx({ rootName: "Len" }))
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") return
    expect(outcome.errors[0]).toContain("@valibot/to-json-schema rejected the schema")
    expect(outcome.errors[0]).toContain("transform")
  })

  it("rejects an arktype schema its native converter cannot express", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(type("bigint"), ctx({ rootName: "Big" }))
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") return
    expect(outcome.errors[0]).toStartWith("Big: cannot convert arktype schema to JSON Schema: ")
  })

  it("rejects with install guidance when @valibot/to-json-schema is missing (DI seam)", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      v.object({ a: v.string() }),
      ctx({
        rootName: "Doc",
        importModule: (specifier) =>
          specifier === "@valibot/to-json-schema"
            ? Promise.reject(new Error("Cannot find package"))
            : import(specifier),
      }),
    )
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") return
    expect(outcome.errors[0]).toContain('"@valibot/to-json-schema" is not installed in the project')
    expect(outcome.errors[0]).toContain("bun add -D @valibot/to-json-schema")
  })

  it("rejects an allowed vendor that has no converter, naming the vendor", async () => {
    const fake = {
      "~standard": { version: 1, vendor: "mystery", validate: () => ({ value: 1 }) },
    }
    const outcome = await schemaToJsonSchemaViaAdapter(
      fake,
      ctx({ allowedVendors: new Set(["tskm", "mystery"]) }),
    )
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") return
    expect(outcome.errors[0]).toContain('vendor "mystery" provides no JSON Schema converter')
  })

  it("rejects a value that is not a Standard Schema", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter({ plain: true }, ctx({ rootName: "X" }))
    expect(outcome).toEqual({
      kind: "rejected",
      errors: ["X: cannot convert the value to JSON Schema: it is not a Standard Schema."],
    })
  })
})

describe("schemaToJsonSchemaViaAdapter — non-finite numbers in vendor schemas", () => {
  // zod and valibot would write a non-finite literal as `null`. Their hooks refuse it instead.
  // Vendor schemas have no approximation, so these are errors even with nonfinite listed.
  const approximateAll = { approximate: ["nonfinite" as const] }

  it("rejects a zod literal(Infinity), with the value and the vendor", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      z.literal(Number.POSITIVE_INFINITY),
      ctx({ rootName: "Limit", ...approximateAll }),
    )
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") return
    expect(outcome.errors[0]).toStartWith("Limit: cannot convert zod schema to JSON Schema: ")
    expect(outcome.errors[0]).toContain("Infinity has no JSON representation")
  })

  it("rejects a zod literal(NaN) nested in a union, and a multi-value literal with -Infinity", async () => {
    const nested = await schemaToJsonSchemaViaAdapter(
      z.object({ mode: z.union([z.literal(Number.NaN), z.string()]) }),
      ctx(),
    )
    expect(nested.kind).toBe("rejected")
    if (nested.kind === "rejected")
      expect(nested.errors[0]).toContain("NaN has no JSON representation")

    const multi = await schemaToJsonSchemaViaAdapter(
      z.literal([1, Number.NEGATIVE_INFINITY]),
      ctx(),
    )
    expect(multi.kind).toBe("rejected")
    if (multi.kind === "rejected")
      expect(multi.errors[0]).toContain("-Infinity has no JSON representation")
  })

  it("rejects a zod numeric check whose bound is not finite (minimum, maximum, minLength)", async () => {
    for (const schema of [
      z.number().min(Number.POSITIVE_INFINITY),
      z.number().max(Number.NEGATIVE_INFINITY),
      z.string().min(Number.POSITIVE_INFINITY),
    ]) {
      const outcome = await schemaToJsonSchemaViaAdapter(schema, ctx())
      expect(outcome.kind).toBe("rejected")
    }
  })

  it("still converts finite zod literals and bounds unchanged", async () => {
    const literal = await schemaToJsonSchemaViaAdapter(z.literal(1), ctx())
    expect(literal.kind).toBe("converted")
    if (literal.kind === "converted")
      expect(literal.schema).toMatchObject({ type: "number", const: 1 })
    const bounded = await schemaToJsonSchemaViaAdapter(z.number().min(0).max(9), ctx())
    expect(bounded.kind).toBe("converted")
    if (bounded.kind === "converted")
      expect(bounded.schema).toMatchObject({ minimum: 0, maximum: 9 })
  })

  it("rejects a valibot literal(Infinity), also nested in an object, and a picklist with NaN", async () => {
    const literal = await schemaToJsonSchemaViaAdapter(
      v.literal(Number.POSITIVE_INFINITY),
      ctx({ rootName: "Limit" }),
    )
    expect(literal.kind).toBe("rejected")
    if (literal.kind === "rejected")
      expect(literal.errors[0]).toContain("Infinity has no JSON representation")

    const nested = await schemaToJsonSchemaViaAdapter(
      v.object({ code: v.picklist([1, Number.NaN]) }),
      ctx(),
    )
    expect(nested.kind).toBe("rejected")
    if (nested.kind === "rejected")
      expect(nested.errors[0]).toContain("NaN has no JSON representation")
  })

  it("still converts a finite valibot literal and picklist", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      v.object({ kind: v.literal("a"), n: v.picklist([1, 2]) }),
      ctx(),
    )
    expect(outcome.kind).toBe("converted")
  })

  // Known gap, pinned: valibot's `overrideSchema` is not called for pipe actions, so a non-finite
  // bound (`minValue(Infinity)`) reaches the output as a value that serializes to `null`. Arktype
  // has no hook at all, so `atLeast(-Infinity)` does the same. Both stay pinned so that a change
  // (a converter that rejects them, or a guard that catches them) fails this test on purpose.
  it("known gap: a valibot non-finite bound is not refused (the value is written as null)", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      v.pipe(v.number(), v.minValue(Number.POSITIVE_INFINITY)),
      ctx(),
    )
    expect(outcome.kind).toBe("converted")
    if (outcome.kind === "converted") expect(outcome.schema.minimum).toBe(Number.POSITIVE_INFINITY)
  })

  it("known gap: an arktype non-finite bound is not refused (the value is written as null)", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      type("number").atLeast(Number.NEGATIVE_INFINITY),
      ctx(),
    )
    expect(outcome.kind).toBe("converted")
    if (outcome.kind === "converted") expect(outcome.schema.minimum).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe("schemaToJsonSchemaViaAdapter — valibot io", () => {
  it("io input converts a transform pipe exactly (the schema before the transform)", async () => {
    const piped = v.pipe(
      v.string(),
      v.transform((s) => s.length),
    )
    const outcome = await schemaToJsonSchemaViaAdapter(piped, ctx({ io: "input" }))
    expect(outcome.kind).toBe("converted")
    if (outcome.kind === "converted") expect(outcome.schema).toMatchObject({ type: "string" })
  })
})

describe("schemaToJsonSchemaViaAdapter — skip and exclusion policies", () => {
  it("excludes a vendor outside the allow-list, naming the runtime vendor", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      z.object({ a: z.string() }),
      ctx({ allowedVendors: new Set(["tskm"]) }),
    )
    // The vendor travels with the outcome so the parent can aggregate a
    // diagnostic instead of dropping the schema without feedback.
    expect(outcome).toEqual({ kind: "excluded", vendor: "zod" })
  })
})

describe("converter packages resolve from the project first", () => {
  // A throwaway project with its own @valibot/to-json-schema, whose output is recognizable.
  // A schema module in it must use the project's copy, as its own imports would.
  let project: string
  let bare: string

  beforeAll(() => {
    project = mkdtempSync(join(tmpdir(), "tskm-resolve-"))
    const pkg = join(project, "node_modules", "@valibot", "to-json-schema")
    mkdirSync(join(pkg), { recursive: true })
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "@valibot/to-json-schema", version: "0.0.0-test", main: "index.cjs" }),
    )
    writeFileSync(
      join(pkg, "index.cjs"),
      "exports.toJsonSchema = () => ({ 'x-project-copy': true })\n",
    )
    mkdirSync(join(project, "src"), { recursive: true })
    // A directory with no node_modules above it: the project has no converter, so the
    // compiler's own resolution is the one that answers.
    bare = mkdtempSync(join(tmpdir(), "tskm-bare-"))
  })

  afterAll(() => {
    rmSync(project, { recursive: true, force: true })
    rmSync(bare, { recursive: true, force: true })
  })

  it("uses the project's copy when the schema module's project has one", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      v.object({ a: v.string() }),
      ctx({ importFrom: join(project, "src", "schema.ts") }),
    )
    expect(outcome).toEqual({ kind: "converted", schema: { "x-project-copy": true }, warnings: [] })
  })

  it("falls back to the compiler's own resolution when the project has no converter", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      v.object({ a: v.string() }),
      ctx({ importFrom: join(bare, "schema.ts") }),
    )
    expect(outcome.kind).toBe("converted")
    if (outcome.kind === "converted") expect(outcome.schema.type).toBe("object")
  })
})

describe("schemaToJsonSchemaViaAdapter — zod fallback (no native ~standard.jsonSchema)", () => {
  // Modern zod schemas carry a spec-1.1 `~standard.jsonSchema` method and take the native
  // path. These cases pin the SEPARATE `z.toJSONSchema` fallback used when that method is
  // absent (older zod), via a fake zod-vendor value with no native converter plus the
  // `importModule` DI seam standing in for the user's project `zod`.
  const zodVendorValue = {
    "~standard": { version: 1, vendor: "zod", validate: () => ({ value: {} }) },
  }

  it("converts via z.toJSONSchema, forwarding io, unrepresentable:'throw', and the non-finite override", async () => {
    let seenArgs: { io?: string; unrepresentable?: string; override?: unknown } | undefined
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
                    opts: { io: string; unrepresentable: string; override: unknown },
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
    // throw (so they collapse to a `rejected`, never a silently-lossy schema).
    expect(seenArgs?.io).toBe("input")
    expect(seenArgs?.unrepresentable).toBe("throw")
    expect(typeof seenArgs?.override).toBe("function")
  })

  it("rejects with a project-import message when zod cannot be imported", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      zodVendorValue,
      ctx({
        importModule: (specifier) =>
          specifier === "zod"
            ? Promise.reject(new Error("Cannot find package 'zod'"))
            : import(specifier),
      }),
    )
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") return
    expect(outcome.errors[0]).toContain('could not import "zod" from the project')
  })

  it("rejects an installed zod that has no z.toJSONSchema (zod 3), and says what to upgrade", async () => {
    const outcome = await schemaToJsonSchemaViaAdapter(
      zodVendorValue,
      ctx({ importModule: () => Promise.resolve({ z: {} }) }),
    )
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") return
    expect(outcome.errors[0]).toContain("has no z.toJSONSchema (zod 4 provides it)")
  })

  it("rejects with the converter's reason when z.toJSONSchema rejects the schema", async () => {
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
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") return
    expect(outcome.errors[0]).toContain("z.toJSONSchema rejected the schema")
    expect(outcome.errors[0]).toContain("unrepresentable type")
  })
})
