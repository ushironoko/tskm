import { schemaToJsonSchema } from "../src/jsonschema.ts"
import { describe, expect, it } from "./test-api.ts"

// Duck-typed builders (the walker reads `.type`/`.literal`/`.options`/`.requirement`, never
// instanceof). A non-finite number has no JSON value: `JSON.stringify` writes it as `null`,
// so each position is tested for the default (error) and for the opt-in `nonfinite`.
const lit = (literal: unknown) => ({ kind: "schema", type: "literal", literal })
const num = () => ({ kind: "schema", type: "number" })
const str = () => ({ kind: "schema", type: "string" })
const arr = (item: unknown) => ({ kind: "schema", type: "array", item })
const pipe = (base: unknown, ...items: unknown[]) => ({
  ...(base as object),
  pipe: [base, ...items],
})
const withRequirement = (type: string, requirement: unknown) => ({
  kind: "validation",
  type,
  requirement,
})

/** The offer that every default error ends with. */
const OFFER = (effect: string) =>
  `Add "nonfinite" to jsonSchema.approximate (CLI: --approximate nonfinite) to emit it ${effect} instead.`

describe("schemaToJsonSchema — literal values", () => {
  it("refuses Infinity, -Infinity, and NaN by default, naming the path and the option", () => {
    const schema = {
      kind: "schema",
      type: "object",
      entries: { limit: lit(Infinity) },
      rest: "strip",
    }
    const result = schemaToJsonSchema(schema, { rootName: "Quota" })
    expect(result.errors).toEqual([
      `Quota.limit: cannot convert schema type "literal" to JSON Schema: Infinity has no JSON representation. ${OFFER("as a schema no JSON value matches")}`,
    ])
  })

  it("names each non-finite value by its own text", () => {
    expect(schemaToJsonSchema(lit(-Infinity), { rootName: "A" }).errors[0]).toContain(
      "-Infinity has no JSON representation",
    )
    expect(schemaToJsonSchema(lit(Number.NaN), { rootName: "A" }).errors[0]).toContain(
      "NaN has no JSON representation",
    )
  })

  it("emits a schema no JSON value matches when nonfinite is listed (the same as never)", () => {
    const result = schemaToJsonSchema(lit(Number.NaN), { approximate: ["nonfinite"] })
    expect(result.errors).toEqual([])
    expect(result.schema).toEqual({ not: {} })
    expect(result.warnings).toEqual([
      "schema: approximated nonfinite as a schema no JSON value matches.",
    ])
  })

  it("keeps the finite numbers, strings, booleans, and null as const values", () => {
    expect(schemaToJsonSchema(lit(0)).schema).toEqual({ const: 0 })
    expect(schemaToJsonSchema(lit(-1.5)).schema).toEqual({ const: -1.5 })
    expect(schemaToJsonSchema(lit(true)).schema).toEqual({ const: true })
    expect(schemaToJsonSchema(lit(null)).schema).toEqual({ const: null })
  })

  it("refuses a bigint literal as an error that no approximation accepts", () => {
    const result = schemaToJsonSchema(lit(10n), {
      rootName: "A",
      approximate: ["bigint", "nonfinite"],
    })
    expect(result.errors).toEqual([
      'A: cannot convert schema type "literal" to JSON Schema: a bigint value has no JSON representation.',
    ])
    expect(result.schema).toEqual({})
  })
})

describe("schemaToJsonSchema — picklist options", () => {
  const picklist = (options: unknown[]) => ({ kind: "schema", type: "picklist", options })

  it("refuses a non-finite option by default", () => {
    const result = schemaToJsonSchema(picklist([1, Number.NaN, 2]), { rootName: "Code" })
    expect(result.errors).toEqual([
      `Code: cannot convert schema type "picklist" to JSON Schema: option NaN has no JSON representation. ${OFFER("by dropping the option NaN")}`,
    ])
  })

  it("drops a non-finite option from the enum when nonfinite is listed, and warns", () => {
    const result = schemaToJsonSchema(picklist([1, Number.POSITIVE_INFINITY, 2]), {
      rootName: "Code",
      approximate: ["nonfinite"],
    })
    expect(result.errors).toEqual([])
    expect(result.schema).toEqual({ enum: [1, 2] })
    expect(result.warnings).toEqual([
      "Code: approximated nonfinite by dropping the option Infinity.",
    ])
  })

  it("keeps an empty enum when every option is dropped (it matches nothing, as an empty picklist does)", () => {
    const result = schemaToJsonSchema(picklist([Number.NaN]), { approximate: ["nonfinite"] })
    expect(result.schema).toEqual({ enum: [] })
  })

  it("refuses a bigint option even when nonfinite is listed", () => {
    const result = schemaToJsonSchema(picklist(["a", 1n]), {
      rootName: "Code",
      approximate: ["nonfinite"],
    })
    expect(result.errors).toEqual([
      'Code: cannot convert schema type "picklist" to JSON Schema: a bigint option has no JSON representation.',
    ])
  })

  it("keeps strings, booleans, null, and finite numbers", () => {
    expect(schemaToJsonSchema(picklist(["a", true, null, 0])).schema).toEqual({
      enum: ["a", true, null, 0],
    })
  })
})

describe("schemaToJsonSchema — numeric keywords and their requirements", () => {
  it("refuses a non-finite minimum by default, and names the pipe item", () => {
    const schema = pipe(num(), withRequirement("min_value", Number.POSITIVE_INFINITY))
    const result = schemaToJsonSchema(schema, { rootName: "Score" })
    expect(result.errors).toEqual([
      `Score: cannot convert pipe item "min_value" to JSON Schema: Infinity has no JSON representation. ${OFFER("by omitting minimum")}`,
    ])
  })

  it("omits the keyword when nonfinite is listed, so the bound is removed rather than written as null", () => {
    const result = schemaToJsonSchema(
      pipe(num(), withRequirement("max_value", Number.NEGATIVE_INFINITY)),
      {
        rootName: "Score",
        approximate: ["nonfinite"],
      },
    )
    expect(result.errors).toEqual([])
    expect(result.schema).toEqual({ type: "number" })
    expect(result.warnings).toEqual(["Score: approximated nonfinite by omitting maximum."])
  })

  it("covers min_length, max_length, length, and multiple_of, and names the keyword(s)", () => {
    const strNonFinite = (type: string) => pipe(str(), withRequirement(type, Number.NaN))
    expect(schemaToJsonSchema(strNonFinite("min_length"), { rootName: "S" }).errors[0]).toContain(
      "omitting minLength",
    )
    expect(schemaToJsonSchema(strNonFinite("max_length"), { rootName: "S" }).errors[0]).toContain(
      "omitting maxLength",
    )
    expect(
      schemaToJsonSchema(pipe(arr(num()), withRequirement("length", Number.NaN)), { rootName: "S" })
        .errors[0],
    ).toContain("omitting minItems and maxItems")
    expect(
      schemaToJsonSchema(pipe(num(), withRequirement("multiple_of", Number.POSITIVE_INFINITY)), {
        rootName: "S",
      }).errors[0],
    ).toContain("omitting multipleOf")

    const approximated = schemaToJsonSchema(
      pipe(arr(num()), withRequirement("length", Number.NaN)),
      {
        approximate: ["nonfinite"],
      },
    )
    expect(approximated.schema).toEqual({ type: "array", items: { type: "number" } })
  })

  it("keeps the finite bounds unchanged", () => {
    expect(
      schemaToJsonSchema(
        pipe(num(), withRequirement("min_value", 0), withRequirement("max_value", 9)),
      ),
    ).toEqual({
      schema: { type: "number", minimum: 0, maximum: 9 },
      warnings: [],
      errors: [],
    })
  })

  it("refuses a Date bound: it has no keyword form, even when date and nonfinite are listed", () => {
    const schema = pipe({ kind: "schema", type: "date" }, withRequirement("min_value", new Date(0)))
    const result = schemaToJsonSchema(schema, {
      rootName: "When",
      approximate: ["date", "nonfinite"],
    })
    expect(result.errors).toEqual([
      'When: cannot convert pipe item "min_value" to JSON Schema: its requirement is of type Date, not a finite number, so it has no minimum keyword.',
    ])
    expect(result.schema).toEqual({ type: "string", format: "date-time" })
  })

  it("refuses a bigint bound, even when bigint is listed", () => {
    const result = schemaToJsonSchema(pipe(num(), withRequirement("min_value", 5n)), {
      rootName: "N",
      approximate: ["bigint"],
    })
    expect(result.errors).toEqual([
      'N: cannot convert pipe item "min_value" to JSON Schema: its requirement is of type bigint, not a finite number, so it has no minimum keyword.',
    ])
  })

  it("refuses a string bound on a string schema: JSON Schema has no string minimum", () => {
    const result = schemaToJsonSchema(pipe(str(), withRequirement("min_value", "m")), {
      rootName: "Name",
    })
    expect(result.errors).toEqual([
      'Name: cannot convert pipe item "min_value" to JSON Schema: its requirement is of type string, not a finite number, so it has no minimum keyword.',
    ])
  })

  it("does not read a numeric requirement after a transform on the input side", () => {
    // With io "input" the items after a transform describe the output, so they are not
    // converted and cannot fail the input document.
    const transform = { kind: "transformation", type: "transform" }
    const schema = pipe(num(), transform, withRequirement("min_value", Number.POSITIVE_INFINITY))
    const input = schemaToJsonSchema(schema, { io: "input", rootName: "T" })
    expect(input.errors).toEqual([])
    expect(input.schema).toEqual({ type: "number" })
  })
})

describe("schemaToJsonSchema — non-finite values inside containers keep their path", () => {
  it("names the property path of a non-finite literal in a union and an array", () => {
    const schema = {
      kind: "schema",
      type: "object",
      entries: {
        mode: { kind: "schema", type: "union", options: [lit("a"), lit(Number.NaN)] },
        steps: arr(lit(Number.NEGATIVE_INFINITY)),
      },
      rest: "strip",
    }
    const result = schemaToJsonSchema(schema, { rootName: "Plan" })
    expect(result.errors.map((line) => line.split(":")[0])).toEqual([
      "Plan.mode[1]",
      "Plan.steps[]",
    ])
  })
})
