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
import "../../tskm/src/json-schema.ts"
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

function coreOutput(schema: {
  readonly "~standard": {
    readonly jsonSchema: {
      readonly output: (options: typeof draft2020) => Record<string, unknown>
    }
  }
}) {
  return schema["~standard"].jsonSchema.output(draft2020)
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

describe("known divergences the compiler source is not changed for", () => {
  it("bigint, date, and undefined: emitter substitutes, core throws", () => {
    expect(schemaToJsonSchema(bigint()).schema).toEqual({ type: "string" })
    expect(schemaToJsonSchema(date()).schema).toEqual({ type: "string", format: "date-time" })
    expect(schemaToJsonSchema(undefined_()).schema).toEqual({})
    expect(() => coreOutput(bigint())).toThrow(/bigint/)
    expect(() => coreOutput(date())).toThrow(/Date/)
    expect(() => coreOutput(undefined_())).toThrow(/undefined/)
  })

  it("check and transform: emitter skips the item, core refuses output", () => {
    const checked = pipe(
      string(),
      check(() => true),
    )
    const transformed = pipe(
      string(),
      transform((value: string) => value.length),
    )
    expect(schemaToJsonSchema(checked).schema).toEqual({ type: "string" })
    expect(schemaToJsonSchema(transformed).schema).toEqual({ type: "string" })
    expect(() => coreOutput(checked)).toThrow(/check/)
    expect(() => coreOutput(transformed)).toThrow(/transform/)
  })

  it("fallback: emitter does not know the kind and emits {}; core unwraps it", () => {
    const schema = fallback(string(), "x")
    const emitted = schemaToJsonSchema(schema)
    expect(emitted.schema).toEqual({})
    expect(emitted.warnings.some((warning) => warning.includes("fallback"))).toBe(true)
    expect(coreOutput(schema)).toEqual({ type: "string", default: "x" })
  })

  it("preprocess input is {} while the emitter only has the output shape", () => {
    const schema = coerce.number()
    expect(schemaToJsonSchema(schema).schema).toEqual({ type: "number" })
    expect(schema["~standard"].jsonSchema.input(draft2020)).toEqual({})
    expect(coreOutput(schema)).toEqual({ type: "number" })
  })
})
