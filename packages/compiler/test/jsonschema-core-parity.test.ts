import { describe, expect, it } from "bun:test"
import {
  any,
  array,
  arrayAsync,
  bigint,
  boolean,
  brand,
  check,
  coerce,
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

/**
 * The core Standard JSON Schema walker and the compiler emitter
 * (`tskm json-schema`) must agree on draft-2020-12 **output** for every schema
 * the emitter represents without a lossy stand-in. Schemas the emitter warns
 * about and substitutes (bigint, date, undefined, check, transform, fallback)
 * are asserted as known divergences: core throws or emits the real shape, and
 * the compiler source is intentionally not changed.
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
  ["coerce pipe output", pipe(coerce.number(), minValue(1), maxValue(65535))],
  ["nested", object({ items: array(union([string(), nullable(number())])) })],
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

/**
 * Known differences. The compiler emitter warns and substitutes a stand-in.
 * `withJsonSchema` throws, or emits a different side, and compiler src stays as it is.
 * Each case locks both documents so a change on either side fails here.
 */
describe("known differences from the compiler emitter", () => {
  it("bigint: emitter emits a string, core throws", () => {
    const emitted = schemaToJsonSchema(bigint())
    expect(emitted.schema).toEqual({ type: "string" })
    expect(emitted.warnings).toEqual(["tskm: bigint has no JSON representation; emitting string."])
    expect(() => coreOutput(bigint())).toThrow(
      'tskm: cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation',
    )
  })

  it("date: emitter emits a date-time string, core throws", () => {
    const emitted = schemaToJsonSchema(date())
    expect(emitted.schema).toEqual({ type: "string", format: "date-time" })
    expect(emitted.warnings).toEqual(["tskm: Date is serialized as an ISO date-time string."])
    expect(() => coreOutput(date())).toThrow(
      'tskm: cannot convert schema type "date" to JSON Schema: Date has no JSON representation',
    )
  })

  it("undefined: emitter emits {}, core throws", () => {
    const emitted = schemaToJsonSchema(undefined_())
    expect(emitted.schema).toEqual({})
    expect(emitted.warnings).toEqual(["tskm: undefined has no JSON representation; emitting {}."])
    expect(() => coreOutput(undefined_())).toThrow(
      'tskm: cannot convert schema type "undefined" to JSON Schema: undefined has no JSON representation',
    )
  })

  it("check: emitter drops the predicate, core throws", () => {
    const schema = pipe(
      string(),
      check(() => true),
    )
    const emitted = schemaToJsonSchema(schema)
    expect(emitted.schema).toEqual({ type: "string" })
    expect(emitted.warnings).toEqual([
      'tskm: pipe item "check" is not representable in JSON Schema; skipped.',
    ])
    expect(() => coreOutput(schema)).toThrow(
      'tskm: cannot convert pipe item "check" to JSON Schema: a function predicate has no JSON Schema representation',
    )
  })

  it("transform: emitter keeps the base schema, core output throws and input is the pre-transform schema", () => {
    const schema = pipe(
      string(),
      transform((value: string) => value.length),
    )
    const emitted = schemaToJsonSchema(schema)
    expect(emitted.schema).toEqual({ type: "string" })
    expect(emitted.warnings).toEqual([
      'tskm: pipe item "transform" is not representable in JSON Schema; skipped.',
    ])
    expect(coreInput(schema)).toEqual({ type: "string" })
    expect(() => coreOutput(schema)).toThrow(
      'tskm: cannot convert pipe item "transform" to JSON Schema output: the transform\'s output type is not reified at runtime. input() still describes the schema before the transform',
    )
  })

  it("fallback: emitter emits {}, core unwraps the inner schema and puts default on the output", () => {
    const schema = fallback(string(), "x")
    const emitted = schemaToJsonSchema(schema)
    expect(emitted.schema).toEqual({})
    expect(emitted.warnings).toEqual(['tskm: unknown schema type "fallback"; emitting {}.'])
    expect(coreInput(schema)).toEqual({ type: "string" })
    expect(coreOutput(schema)).toEqual({ type: "string", default: "x" })
  })

  it("preprocess input: emitter has only the output shape, core input is {}", () => {
    const schema = coerce.number()
    const emitted = schemaToJsonSchema(schema)
    expect(emitted.schema).toEqual({ type: "number" })
    expect(emitted.warnings).toEqual([
      "tskm: preprocess changes the value before validation; emitted the output shape; input accepts any value.",
    ])
    expect(coreOutput(schema)).toEqual({ type: "number" })
    expect(coreInput(schema)).toEqual({})
  })
})
