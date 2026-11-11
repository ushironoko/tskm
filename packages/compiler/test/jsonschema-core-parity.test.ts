import {
  any,
  array,
  arrayAsync,
  bigint,
  boolean,
  brand,
  check,
  date,
  description,
  discriminatedUnion,
  email,
  exactObject,
  fallback,
  integer,
  lazy,
  literal,
  maxValue,
  minLength,
  minValue,
  never_,
  null_,
  nullable,
  nullish,
  number,
  object,
  optional,
  picklist,
  pipe,
  preprocess,
  readonly,
  record,
  recursive,
  regex,
  string,
  templateLiteral,
  transform,
  tuple,
  undefined_,
  union,
  unknown,
  url,
} from "../../tskm/src/index.ts"
import { withJsonSchema } from "../../tskm/src/json-schema.ts"
import { schemaToJsonSchema } from "../src/jsonschema.ts"
import { describe, expect, it } from "./test-api.ts"

/**
 * The core Standard JSON Schema walker (`withJsonSchema`) and the compiler emitter
 * (`tskm json-schema`) agree on draft-2020-12 output for every schema the emitter can
 * represent, on both sides (`output` and `input`).
 *
 * The types JSON Schema cannot express (bigint, date, undefined, a check predicate, a
 * transform's output) are refused by BOTH by default. The compiler approximates them
 * only when the caller lists them in `jsonSchema.approximate`, and core never does, so
 * those approximations are locked as opt-in divergences.
 *
 * Known gap, locked as an annotation-only difference: the compiler emits no `default`
 * keyword (core emits one for a JSON default on optional/fallback). The types agree.
 */

const draft2020 = { target: "draft-2020-12" } as const

function coreOutput(schema: Parameters<typeof withJsonSchema>[0]) {
  return withJsonSchema(schema)["~standard"].jsonSchema.output(draft2020)
}

function coreInput(schema: Parameters<typeof withJsonSchema>[0]) {
  return withJsonSchema(schema)["~standard"].jsonSchema.input(draft2020)
}

const agree: ReadonlyArray<readonly [string, unknown]> = [
  ["string", string()],
  ["number", number()],
  ["boolean", boolean()],
  ["null", null_()],
  ["literal", literal("hi")],
  ["literal number", literal(7)],
  ["picklist", picklist(["a", "b"])],
  ["any", any()],
  ["unknown", unknown()],
  ["never", never_()],
  [
    "object",
    object({
      id: string(),
      nickname: optional(string()),
      note: nullish(number()),
    }),
  ],
  ["exact", exactObject({ a: string() })],
  ["strip", object({ a: string() }, { rest: "strip" })],
  ["passthrough", object({ a: string() }, { rest: "passthrough" })],
  ["array", array(string())],
  ["arrayAsync", arrayAsync(number())],
  ["record", record(number())],
  ["keyed record", record(templateLiteral(["item_", string()]), number())],
  ["picklist record", record(picklist(["a", "b"]), string())],
  ["tuple", tuple([string(), number()])],
  ["union", union([string(), number()])],
  ["nullable", nullable(string())],
  ["nullish", nullish(string())],
  ["optional", optional(string())],
  ["optional default output", optional(string(), "anon")],
  ["pipe lengths", pipe(string(), minLength(2), description("id"))],
  ["pipe email url regex", pipe(string(), email(), url(), regex(/^a/i))],
  ["pipe integer", pipe(number(), integer(), minValue(0), maxValue(10))],
  ["pipe array", pipe(array(string()), minLength(1))],
  ["brand readonly", pipe(string(), brand("Id"), readonly(), description("kept"))],
  ["template", templateLiteral(["user_", string()])],
  [
    "discriminated",
    discriminatedUnion("k", [
      object({ k: literal("c"), r: number() }),
      object({ k: literal("s"), side: number() }),
    ]),
  ],
  ["lazy", lazy(() => object({ a: string() }))],
  ["recursive", recursive((self) => object({ name: string(), children: array(self) }))],
  ["preprocess output", preprocess((value) => Number(value), number())],
  [
    "preprocess pipe output",
    pipe(
      preprocess((value) => Number(value), number()),
      minValue(1),
      maxValue(65535),
    ),
  ],
  ["nested", object({ items: array(union([string(), nullable(number())])) })],
]

/** The input side: preprocess is `{}`, a transform keeps the pre-transform input shape. */
const inputAgree: ReadonlyArray<readonly [string, unknown]> = [
  ["preprocess input is {}", preprocess((value) => Number(value), number())],
  [
    "piped preprocess input is {}",
    pipe(
      preprocess((value) => Number(value), number()),
      minValue(1),
      maxValue(65535),
    ),
  ],
  ["object with a preprocess entry", object({ n: preprocess((value) => Number(value), number()) })],
  [
    "transform input is the pre-transform shape",
    pipe(
      number(),
      transform((n: number) => `${n}`),
    ),
  ],
  [
    "description after a transform survives on the input",
    pipe(
      number(),
      transform((n: number) => `${n}`),
      description("text"),
    ),
  ],
  ["fallback input is the inner schema", fallback(string(), "x")],
  ["nullish input", nullish(string())],
]

describe("core jsonSchema.output matches the compiler emitter", () => {
  for (const [name, schema] of agree) {
    it(name, () => {
      expect(coreOutput(schema as Parameters<typeof coreOutput>[0])).toEqual(
        schemaToJsonSchema(schema).schema,
      )
    })
  }

  it("a self-referential lazy matches, including the hoisted name", () => {
    const node: ReturnType<typeof lazy> = lazy(() =>
      object({ value: string(), next: optional(node) }),
    )
    expect(coreOutput(node)).toEqual(schemaToJsonSchema(node).schema)
  })
})

describe("core jsonSchema.input matches the compiler emitter", () => {
  for (const [name, schema] of inputAgree) {
    it(name, () => {
      expect(coreInput(schema as Parameters<typeof coreInput>[0])).toEqual(
        schemaToJsonSchema(schema, { io: "input" }).schema,
      )
    })
  }
})

describe("unrepresentable types are refused by both by default", () => {
  it("bigint: core throws, the compiler fails the schema with the option that approximates it", () => {
    expect(() => coreOutput(bigint())).toThrow(
      'tskm: cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation',
    )
    expect(schemaToJsonSchema(bigint(), { rootName: "Amount" }).errors).toEqual([
      'Amount: cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation. Add "bigint" to jsonSchema.approximate (CLI: --approximate bigint) to emit it as a string instead.',
    ])
  })

  it("date: core throws, the compiler fails the schema", () => {
    expect(() => coreOutput(date())).toThrow(
      'tskm: cannot convert schema type "date" to JSON Schema: Date has no JSON representation',
    )
    expect(schemaToJsonSchema(date(), { rootName: "When" }).errors).toEqual([
      'When: cannot convert schema type "date" to JSON Schema: Date has no JSON representation. Add "date" to jsonSchema.approximate (CLI: --approximate date) to emit it as a date-time string instead.',
    ])
  })

  it("undefined: core throws, the compiler fails the schema", () => {
    expect(() => coreOutput(undefined_())).toThrow(
      'tskm: cannot convert schema type "undefined" to JSON Schema: undefined has no JSON representation',
    )
    expect(schemaToJsonSchema(undefined_(), { rootName: "Nothing" }).errors).toEqual([
      'Nothing: cannot convert schema type "undefined" to JSON Schema: undefined has no JSON representation. Add "undefined" to jsonSchema.approximate (CLI: --approximate undefined) to emit it as an unconstrained schema instead.',
    ])
  })

  it("check: core throws, the compiler fails the schema", () => {
    const schema = pipe(
      string(),
      check(() => true),
    )
    expect(() => coreOutput(schema)).toThrow(
      'tskm: cannot convert pipe item "check" to JSON Schema: a function predicate has no JSON Schema representation',
    )
    expect(schemaToJsonSchema(schema, { rootName: "Name" }).errors).toEqual([
      'Name: cannot convert pipe item "check" to JSON Schema: a function predicate has no JSON Schema representation. Add "check" to jsonSchema.approximate (CLI: --approximate check) to emit it without the predicate instead.',
    ])
  })

  it("transform on the output side: core throws, the compiler fails and names io as the other way out", () => {
    const schema = pipe(
      string(),
      transform((value: string) => value.length),
    )
    expect(coreInput(schema)).toEqual({ type: "string" })
    expect(() => coreOutput(schema)).toThrow(
      'tskm: cannot convert pipe item "transform" to JSON Schema output: the transform\'s output type is not reified at runtime. input() still describes the schema before the transform',
    )
    expect(schemaToJsonSchema(schema, { rootName: "Doc" }).errors).toEqual([
      'Doc: cannot convert pipe item "transform" to JSON Schema output: the transform\'s output type is not reified at runtime. Add "transform" to jsonSchema.approximate (CLI: --approximate transform) to emit it as the schema before the transform instead. Or set jsonSchema.io to "input", which needs no approximation.',
    ])
  })
})

/**
 * Opt-in divergences. Core still throws for these, so the compiler's approximation is the
 * only one of the two that exists. Each case locks the approximated document.
 */
describe("opt-in approximations (the compiler only; core still throws)", () => {
  it("bigint as a string", () => {
    expect(schemaToJsonSchema(bigint(), { approximate: ["bigint"] }).schema).toEqual({
      type: "string",
    })
    expect(() => coreOutput(bigint())).toThrow()
  })

  it("date as a date-time string", () => {
    expect(schemaToJsonSchema(date(), { approximate: ["date"] }).schema).toEqual({
      type: "string",
      format: "date-time",
    })
    expect(() => coreOutput(date())).toThrow()
  })

  it("undefined as an unconstrained schema", () => {
    expect(schemaToJsonSchema(undefined_(), { approximate: ["undefined"] }).schema).toEqual({})
    expect(() => coreOutput(undefined_())).toThrow()
  })

  it("check with the predicate dropped", () => {
    const schema = pipe(
      string(),
      check(() => true),
    )
    expect(schemaToJsonSchema(schema, { approximate: ["check"] }).schema).toEqual({
      type: "string",
    })
    expect(() => coreOutput(schema)).toThrow()
  })

  it("transform on the output side as the schema before the transform", () => {
    const schema = pipe(
      string(),
      transform((value: string) => value.length),
    )
    expect(schemaToJsonSchema(schema, { approximate: ["transform"] }).schema).toEqual({
      type: "string",
    })
    expect(() => coreOutput(schema)).toThrow()
  })
})

/**
 * A value JSON cannot carry (NaN and the infinities) is refused by both by default. The compiler
 * approximates it only when `nonfinite` is listed, and core never approximates, so that opt-in is
 * a divergence, locked here.
 */
describe("non-finite numbers are refused by both by default", () => {
  it("literal(Infinity), literal(-Infinity), literal(NaN): core throws, the compiler fails the schema", () => {
    expect(() => coreOutput(literal(Number.POSITIVE_INFINITY))).toThrow(
      'tskm: cannot convert schema type "literal" to JSON Schema: Infinity has no JSON representation',
    )
    expect(() => coreOutput(literal(Number.NaN))).toThrow(/NaN has no JSON representation/)
    expect(
      schemaToJsonSchema(literal(Number.NEGATIVE_INFINITY), { rootName: "Limit" }).errors,
    ).toEqual([
      'Limit: cannot convert schema type "literal" to JSON Schema: -Infinity has no JSON representation. Add "nonfinite" to jsonSchema.approximate (CLI: --approximate nonfinite) to emit it as a schema no JSON value matches instead.',
    ])
  })

  it("a picklist option: core throws, the compiler fails the schema", () => {
    expect(() => coreOutput(picklist([1, Number.NaN]))).toThrow(
      'tskm: cannot convert schema type "picklist" option to JSON Schema: NaN has no JSON representation',
    )
    expect(schemaToJsonSchema(picklist([1, Number.NaN]), { rootName: "Code" }).errors).toEqual([
      'Code: cannot convert schema type "picklist" to JSON Schema: option NaN has no JSON representation. Add "nonfinite" to jsonSchema.approximate (CLI: --approximate nonfinite) to emit it by dropping the option NaN instead.',
    ])
  })

  it("a numeric bound: core throws, the compiler fails the schema", () => {
    const schema = pipe(number(), minValue(Number.POSITIVE_INFINITY))
    expect(() => coreOutput(schema)).toThrow(
      'tskm: cannot convert pipe item "min_value" to JSON Schema: Infinity has no JSON representation',
    )
    expect(schemaToJsonSchema(schema, { rootName: "Score" }).errors[0]).toContain(
      'Score: cannot convert pipe item "min_value" to JSON Schema: Infinity has no JSON representation.',
    )
  })

  it("nonfinite is an opt-in divergence: the compiler approximates, core still refuses", () => {
    const schema = literal(Number.NaN)
    expect(schemaToJsonSchema(schema, { approximate: ["nonfinite"] }).schema).toEqual({ not: {} })
    expect(() => coreOutput(schema)).toThrow(/NaN has no JSON representation/)
  })
})

/**
 * Known gap: annotation-only. The compiler emits no `default` keyword, so the types agree
 * but the documents differ. Each case locks both documents so a change on either side fails.
 */
describe("known annotation differences: the compiler emits no default keyword", () => {
  it("fallback output: core adds default on the output, the compiler does not", () => {
    const schema = fallback(string(), "x")
    expect(schemaToJsonSchema(schema).schema).toEqual({ type: "string" })
    expect(coreOutput(schema)).toEqual({ type: "string", default: "x" })
  })

  it("optional default input: core adds default on the input, the compiler does not", () => {
    const schema = optional(string(), "anon")
    expect(schemaToJsonSchema(schema, { io: "input" }).schema).toEqual({ type: "string" })
    expect(coreInput(schema)).toEqual({ type: "string", default: "anon" })
  })
})
