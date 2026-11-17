// biome-ignore-all lint/suspicious/noTemplateCurlyInString: assertions compare template-literal text that contains "${...}"
import { describe, expect, it } from "bun:test"
import {
  any,
  array,
  arrayAsync,
  bigint,
  boolean,
  brand,
  check,
  checkAsync,
  date,
  description,
  discriminatedUnion,
  email,
  exactObject,
  fallback,
  integer,
  lazy,
  length,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  multipleOf,
  never_,
  nonEmpty,
  null_,
  nullable,
  nullish,
  number,
  object,
  optional,
  picklist,
  pipe,
  pipeAsync,
  preprocess,
  readonly,
  record,
  recursive,
  regex,
  string,
  templateLiteral,
  transform,
  transformAsync,
  tuple,
  undefined_,
  union,
  unknown,
  url,
} from "../src/index.ts"
import { convertToJsonSchema } from "../src/json-schema/convert.ts"
import { withJsonSchema } from "../src/json-schema.ts"

const draft = { target: "draft-2020-12" } as const
const draft07 = { target: "draft-07" } as const
const openapi = { target: "openapi-3.0" } as const

function output(schema: Parameters<typeof withJsonSchema>[0]) {
  return withJsonSchema(schema)["~standard"].jsonSchema.output(draft)
}

function input(schema: Parameters<typeof withJsonSchema>[0]) {
  return withJsonSchema(schema)["~standard"].jsonSchema.input(draft)
}

function jsonSchema(schema: Parameters<typeof withJsonSchema>[0]) {
  return withJsonSchema(schema)["~standard"].jsonSchema
}

describe("Standard JSON Schema — representable schemas", () => {
  it("maps scalar leaves, literal, picklist, any, unknown, and never", () => {
    expect(output(string())).toEqual({ type: "string" })
    expect(output(number())).toEqual({ type: "number" })
    expect(output(boolean())).toEqual({ type: "boolean" })
    expect(output(null_())).toEqual({ type: "null" })
    expect(output(literal("hi"))).toEqual({ const: "hi" })
    expect(output(literal(7))).toEqual({ const: 7 })
    expect(output(literal(true))).toEqual({ const: true })
    expect(output(picklist(["a", "b"]))).toEqual({ enum: ["a", "b"] })
    expect(output(any())).toEqual({})
    expect(output(unknown())).toEqual({})
    expect(output(never_())).toEqual({ not: {} })
    expect(input(string())).toEqual(output(string()))
  })

  it("emits object properties, required keys, and the rest policy", () => {
    const schema = object({
      id: string(),
      nickname: optional(string()),
      note: nullish(string()),
    })
    expect(output(schema)).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
        nickname: { type: "string" },
        note: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["id"],
      additionalProperties: false,
    })
    expect(output(exactObject({ a: string() })).additionalProperties).toBe(false)
    expect(output(object({ a: string() }, { rest: "strip" })).additionalProperties).toBe(false)
    expect(output(object({ a: string() }, { rest: "passthrough" })).additionalProperties).toBe(true)
  })

  it("maps array, record, tuple, union, nullable, and nullish", () => {
    expect(output(array(string()))).toEqual({ type: "array", items: { type: "string" } })
    expect(output(arrayAsync(number()))).toEqual({ type: "array", items: { type: "number" } })
    expect(output(record(number()))).toEqual({
      type: "object",
      additionalProperties: { type: "number" },
    })
    expect(output(record(picklist(["a", "b"]), number()))).toEqual({
      type: "object",
      additionalProperties: { type: "number" },
      propertyNames: { enum: ["a", "b"] },
    })
    expect(output(tuple([string(), number()]))).toEqual({
      type: "array",
      prefixItems: [{ type: "string" }, { type: "number" }],
      items: false,
    })
    expect(output(union([string(), number()]))).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    })
    expect(output(nullable(string()))).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    })
    expect(output(nullish(string()))).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    })
  })

  it("folds pipe validations and description, and skips brand and readonly", () => {
    expect(output(pipe(string(), minLength(3)))).toEqual({ type: "string", minLength: 3 })
    expect(output(pipe(string(), maxLength(8), length(4)))).toEqual({
      type: "string",
      minLength: 4,
      maxLength: 4,
    })
    expect(output(pipe(string(), email(), url(), regex(/^a/)))).toEqual({
      type: "string",
      format: "uri",
      pattern: "^a",
    })
    expect(output(pipe(number(), integer(), minValue(1), maxValue(9), multipleOf(2)))).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 9,
      multipleOf: 2,
    })
    expect(output(pipe(array(string()), minLength(2), nonEmpty()))).toEqual({
      type: "array",
      items: { type: "string" },
      minItems: 1,
    })
    expect(output(pipe(string(), description("first"), description("second")))).toEqual({
      type: "string",
      description: "second",
    })
    expect(output(pipe(string(), brand("UserId"), readonly()))).toEqual({ type: "string" })
    expect(output(pipeAsync(string(), minLength(2)))).toEqual({ type: "string", minLength: 2 })
  })

  it("maps template literals and discriminated unions", () => {
    expect(output(templateLiteral(["user_", string()]))).toEqual({
      type: "string",
      pattern: "^user_[\\s\\S]*?$",
      "x-tskm-template": "`user_${string}`",
    })
    expect(
      output(
        discriminatedUnion("kind", [
          object({ kind: literal("a"), n: number() }),
          object({ kind: literal("b"), s: string() }),
        ]),
      ),
    ).toEqual({
      oneOf: [
        {
          type: "object",
          properties: { kind: { const: "a" }, n: { type: "number" } },
          required: ["kind", "n"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { kind: { const: "b" }, s: { type: "string" } },
          required: ["kind", "s"],
          additionalProperties: false,
        },
      ],
      "x-tskm-discriminant": "kind",
    })
  })

  it("hoists a recursive cycle into $defs and inlines an acyclic lazy", () => {
    const category = recursive((self) => object({ name: string(), children: array(self) }))
    expect(output(category)).toEqual({
      $ref: "#/$defs/recursive",
      $defs: {
        recursive: {
          type: "object",
          properties: {
            name: { type: "string" },
            children: { type: "array", items: { $ref: "#/$defs/recursive" } },
          },
          required: ["name", "children"],
          additionalProperties: false,
        },
      },
    })
    expect(output(lazy(() => string()))).toEqual({ type: "string" })
  })

  it("names a hoisted cycle from libraryOptions.name", () => {
    const category = recursive((self) => object({ name: string(), children: array(self) }))
    expect(
      jsonSchema(category).output({
        target: "draft-2020-12",
        libraryOptions: { name: "Category" },
      }).$ref,
    ).toBe("#/$defs/Category")
    const left = recursive((self) => object({ left: optional(self) }))
    const right = recursive((self) => object({ right: optional(self) }))
    const defs = output(object({ left, right })).$defs as Record<string, unknown>
    expect(Object.keys(defs).sort()).toEqual(["recursive", "recursive_2"])
  })

  it("hoists a reused recursive node once and references it from every use site", () => {
    // The SAME recursive schema object appears under two properties. The cycle guard
    // keys on object identity, so the node is emitted into $defs a single time and both
    // properties resolve to that one $ref — not two independent copies of the subtree.
    const node = recursive((self) => object({ value: string(), next: optional(self) }))
    const document = output(object({ left: node, right: node }))
    expect(document.properties).toEqual({
      left: { $ref: "#/$defs/recursive" },
      right: { $ref: "#/$defs/recursive" },
    })
    const defs = document.$defs as Record<string, unknown>
    expect(Object.keys(defs)).toEqual(["recursive"])
  })

  it("gives a recursive node nested in another of the same base name a distinct $defs key", () => {
    // `inner` is hoisted while `outer` is still being walked (outer has a name but is not
    // yet stored in $defs), so the collision is caught by the in-flight name set, not by
    // an already-stored def. Both default to the base name "recursive"; the inner one must
    // still get a unique "recursive_2" key so the two cycles never share a definition.
    const inner = recursive((self) => object({ tag: string(), self: optional(self) }))
    const outer = recursive((self) => object({ loop: optional(self), child: inner }))
    const document = output(outer)
    expect(document.$ref).toBe("#/$defs/recursive")
    const defs = document.$defs as Record<string, Record<string, unknown>>
    expect(Object.keys(defs).sort()).toEqual(["recursive", "recursive_2"])
    expect((defs.recursive?.properties as Record<string, unknown>).child).toEqual({
      $ref: "#/$defs/recursive_2",
    })
    expect((defs.recursive_2?.properties as Record<string, unknown>).self).toEqual({
      $ref: "#/$defs/recursive_2",
    })
  })

  it("returns a fresh document on every call", () => {
    const schema = object({ a: string() })
    const first = output(schema)
    first.additionalProperties = "mutated"
    expect(output(schema).additionalProperties).toBe(false)
  })
})

describe("Standard JSON Schema — input and output", () => {
  it("puts a JSON default on optional/nullable/nullish input only", () => {
    const schema = optional(string(), "anon")
    expect(input(schema)).toEqual({ type: "string", default: "anon" })
    expect(output(schema)).toEqual({ type: "string" })
    expect(input(nullable(number(), 0))).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
      default: 0,
    })
    expect(output(nullable(number(), 0))).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
    })
    expect(input(nullish(boolean(), false))).toEqual({
      anyOf: [{ type: "boolean" }, { type: "null" }],
      default: false,
    })
    const nested = object({ name: optional(string(), "anon") })
    expect((input(nested).properties as { name: unknown }).name).toEqual({
      type: "string",
      default: "anon",
    })
    expect((output(nested).properties as { name: unknown }).name).toEqual({ type: "string" })
    expect(input(nested).required).toEqual([])
  })

  it("throws when an input default is not JSON and still emits the output type", () => {
    const fn = optional(string(), () => "x")
    expect(output(fn)).toEqual({ type: "string" })
    expect(() => input(fn)).toThrow(
      "tskm: cannot represent a default value in JSON Schema: the default is a function",
    )
    expect(() => input(optional(string(), 1n as unknown as string))).toThrow(
      "tskm: cannot represent a default value in JSON Schema: the default is a bigint",
    )
    expect(input(optional(unknown(), [1, "a"]))).toEqual({ default: [1, "a"] })
    expect(input(optional(unknown(), { ok: true }))).toEqual({ default: { ok: true } })
    expect(() => input(optional(number(), Number.NaN))).toThrow(
      "tskm: cannot represent a default value in JSON Schema: the default is not a finite number",
    )
    expect(() => input(optional(unknown(), Symbol("x") as unknown))).toThrow(
      "tskm: cannot represent a default value in JSON Schema: the default is a symbol",
    )
    expect(() =>
      convertToJsonSchema(
        { type: "optional", wrapped: { type: "string" }, default: new Date(0) },
        "input",
        draft,
      ),
    ).toThrow(
      "tskm: cannot represent a default value in JSON Schema: the value does not round-trip through JSON",
    )
    expect(() =>
      convertToJsonSchema(
        { type: "optional", wrapped: { type: "unknown" }, default: [undefined] },
        "input",
        draft,
      ),
    ).toThrow(/round-trip through JSON/)
    expect(() =>
      convertToJsonSchema(
        { type: "optional", wrapped: { type: "unknown" }, default: { a: undefined } },
        "input",
        draft,
      ),
    ).toThrow(/round-trip through JSON/)
    // A non-finite number nested in an object default survives JSON.stringify as `null`
    // (same key count), so the mismatch is only caught by comparing the values per key.
    expect(() =>
      convertToJsonSchema(
        { type: "optional", wrapped: { type: "unknown" }, default: { a: Number.NaN } },
        "input",
        draft,
      ),
    ).toThrow(/round-trip through JSON/)
    expect(() =>
      convertToJsonSchema(
        { type: "fallback", wrapped: { type: "string" }, fallback: undefined },
        "output",
        draft,
      ),
    ).toThrow("tskm: cannot represent a default value in JSON Schema: the default is undefined")
  })

  it("splits preprocess into an open input and a constrained output", () => {
    const schema = pipe(
      preprocess((value) => Number(value), number()),
      minValue(1),
      maxValue(9),
    )
    expect(input(schema)).toEqual({})
    expect(output(schema)).toEqual({ type: "number", minimum: 1, maximum: 9 })
    expect(input(preprocess((value) => value, bigint()))).toEqual({})
    expect(() => output(preprocess((value) => value, bigint()))).toThrow(/bigint/)
  })

  it("describes transform input and refuses the unreified output", () => {
    const schema = pipe(
      string(),
      minLength(1),
      description("before"),
      transform((value: string) => value.length),
      description("after"),
      minValue(0),
    )
    expect(input(schema)).toEqual({ type: "string", minLength: 1, description: "after" })
    expect(() => output(schema)).toThrow(
      'tskm: cannot convert pipe item "transform" to JSON Schema output: the transform\'s output type is not reified at runtime. input() still describes the schema before the transform',
    )
    expect(() =>
      output(
        pipeAsync(
          string(),
          transformAsync(async (value: string) => value),
        ),
      ),
    ).toThrow(/transform/)
  })

  it("puts a JSON fallback on the output only", () => {
    const schema = fallback(string(), "x")
    expect(input(schema)).toEqual({ type: "string" })
    expect(output(schema)).toEqual({ type: "string", default: "x" })
    expect(() => output(fallback(string(), 1n as unknown as string))).toThrow(/bigint/)
  })
})

describe("Standard JSON Schema — targets", () => {
  const schema = object({
    id: string(),
    nick: optional(string()),
    pos: tuple([number(), number()]),
    tag: literal("a"),
    box: nullable(string()),
  })

  it("rewrites tuples, consts, nulls, and $defs for draft-07", () => {
    expect(jsonSchema(schema).output(draft07)).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
        nick: { type: "string" },
        pos: {
          type: "array",
          items: [{ type: "number" }, { type: "number" }],
          additionalItems: false,
        },
        tag: { const: "a" },
        box: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["id", "pos", "tag", "box"],
      additionalProperties: false,
    })
    const category = recursive((self) => object({ name: string(), children: array(self) }))
    const json = jsonSchema(category).output(draft07)
    expect(json.$ref).toBe("#/definitions/recursive")
    expect(json.$defs).toBeUndefined()
    expect(json.definitions).toBeDefined()
  })

  it("rewrites OpenAPI 3.0 tuples, consts, and nullable", () => {
    expect(jsonSchema(schema).input(openapi)).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
        nick: { type: "string" },
        pos: {
          type: "array",
          items: { anyOf: [{ type: "number" }, { type: "number" }] },
          minItems: 2,
          maxItems: 2,
        },
        tag: { type: "string", enum: ["a"] },
        box: { type: "string", nullable: true },
      },
      required: ["id", "pos", "tag", "box"],
      additionalProperties: false,
    })
    expect(jsonSchema(schema).output(openapi).properties).toEqual(
      jsonSchema(schema).input(openapi).properties,
    )
    expect(jsonSchema(null_()).output(openapi)).toEqual({
      type: "string",
      nullable: true,
      enum: [null],
    })
    expect(jsonSchema(literal(1)).output(openapi)).toEqual({
      type: "number",
      enum: [1],
    })
    expect(jsonSchema(literal(true)).output(openapi)).toEqual({
      type: "boolean",
      enum: [true],
    })
    const category = recursive((self) => object({ name: string(), child: optional(self) }))
    const nullableCategory = jsonSchema(nullable(category)).output(openapi)
    expect(nullableCategory.nullable).toBe(true)
    expect(nullableCategory.allOf).toEqual([{ $ref: "#/definitions/recursive" }])
    expect(nullableCategory.$ref).toBeUndefined()
    expect(jsonSchema(union([string(), number(), null_()])).output(openapi)).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
      nullable: true,
    })
    expect(jsonSchema(union([null_(), null_()])).output(openapi)).toEqual({
      type: "string",
      nullable: true,
      enum: [null],
    })
    expect(jsonSchema(union([string(), number()])).output(openapi)).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    })
    expect(convertToJsonSchema({ type: "literal", literal: null }, "output", openapi)).toEqual({
      type: "string",
      nullable: true,
      enum: [null],
    })
    expect(jsonSchema(tuple([])).output(openapi)).toEqual({
      type: "array",
      items: { anyOf: [] },
      minItems: 0,
      maxItems: 0,
    })
    expect(jsonSchema(tuple([])).output(draft07)).toEqual({
      type: "array",
      items: [],
      additionalItems: false,
    })
  })

  it("refuses keyed records and unknown targets", () => {
    const keyed = record(picklist(["a"]), number())
    expect(() => jsonSchema(keyed).output(openapi)).toThrow(
      'tskm: cannot convert a record key constraint to JSON Schema target "openapi-3.0": propertyNames is not part of OpenAPI 3.0',
    )
    expect(jsonSchema(keyed).output(draft07).propertyNames).toEqual({ enum: ["a"] })
    expect(() => jsonSchema(string()).output({ target: "draft-04" })).toThrow(
      'tskm: unsupported JSON Schema target "draft-04". Supported targets: "draft-2020-12", "draft-07", "openapi-3.0".',
    )
    expect(() => jsonSchema(string()).input({ target: "openapi-3.1" })).toThrow(/openapi-3\.1/)
  })
})

describe("Standard JSON Schema — errors", () => {
  it("refuses bigint, date, undefined, and check", () => {
    expect(() => output(bigint())).toThrow(
      'tskm: cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation',
    )
    expect(() => input(date())).toThrow(
      'tskm: cannot convert schema type "date" to JSON Schema: Date has no JSON representation',
    )
    expect(() => output(undefined_())).toThrow(
      'tskm: cannot convert schema type "undefined" to JSON Schema: undefined has no JSON representation',
    )
    expect(() =>
      output(
        pipe(
          string(),
          check(() => true),
        ),
      ),
    ).toThrow(
      'tskm: cannot convert pipe item "check" to JSON Schema: a function predicate has no JSON Schema representation',
    )
    expect(() =>
      input(
        pipeAsync(
          string(),
          checkAsync(async () => true),
        ),
      ),
    ).toThrow(/check/)
  })

  it("refuses options that are not the spec object", () => {
    expect(() =>
      jsonSchema(string()).input(undefined as unknown as { target: "draft-07" }),
    ).toThrow("tskm: jsonSchema options must be an object with a target")
    expect(() =>
      jsonSchema(string()).output({
        target: "draft-07",
        libraryOptions: null as unknown as Record<string, unknown>,
      }),
    ).toThrow("tskm: jsonSchema libraryOptions must be a plain object when provided")
    expect(() =>
      jsonSchema(string()).output({
        target: "draft-07",
        libraryOptions: ["nope"] as unknown as Record<string, unknown>,
      }),
    ).toThrow(/libraryOptions must be a plain object/)
    expect(() =>
      jsonSchema(string()).output({
        target: "draft-07",
        libraryOptions: { name: "" },
      }),
    ).toThrow('tskm: jsonSchema libraryOptions.name must be a non-empty string without "/" or "#"')
    expect(() =>
      jsonSchema(string()).output({
        target: "draft-07",
        libraryOptions: { name: "a/b" },
      }),
    ).toThrow(/libraryOptions\.name/)
    expect(() =>
      jsonSchema(string()).output({
        target: "draft-07",
        libraryOptions: { name: "a#b" },
      }),
    ).toThrow(/libraryOptions\.name/)
    expect(() =>
      jsonSchema(string()).output({
        target: "draft-07",
        libraryOptions: { name: 1 as unknown as string },
      }),
    ).toThrow(/libraryOptions\.name/)
  })

  it("wraps without throwing and does not mutate the original schema", () => {
    const schema = object({ a: string() })
    const keysBefore = Object.keys(schema).sort()
    const standardBefore = schema["~standard"]
    const runBefore = schema["~run"]
    const unrepresentable = withJsonSchema(bigint())
    const wrapped = withJsonSchema(schema)

    expect(wrapped).not.toBe(schema)
    expect(Object.keys(schema).sort()).toEqual(keysBefore)
    expect(schema["~standard"]).toBe(standardBefore)
    expect(schema["~run"]).toBe(runBefore)
    expect("jsonSchema" in schema["~standard"]).toBe(false)
    expect(wrapped.entries).toBe(schema.entries)
    expect(Object.keys(wrapped["~standard"]).sort()).toEqual([
      "jsonSchema",
      "validate",
      "vendor",
      "version",
    ])
    const first = wrapped["~standard"]
    const second = wrapped["~standard"]
    expect(first).toBe(second)
    expect(first.jsonSchema).toBe(second.jsonSchema)
    expect(first.validate).toBe(schema["~standard"].validate)
    expect(first.validate({ a: "x" })).toEqual({ value: { a: "x" } })
    expect(() => unrepresentable["~standard"].jsonSchema.output(draft)).toThrow(
      'tskm: cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation',
    )
  })
})

describe("Standard JSON Schema — malformed nodes", () => {
  it("rejects shapes the emitter would paper over", () => {
    expect(() => convertToJsonSchema(1, "output", draft)).toThrow(
      "tskm: cannot convert non-object schema (1) to JSON Schema",
    )
    expect(() => convertToJsonSchema(null, "output", draft)).toThrow(/non-object schema/)
    expect(() => convertToJsonSchema({ type: "weird" }, "output", draft)).toThrow(
      'tskm: cannot convert schema type "weird" to JSON Schema: this schema kind has no JSON Schema representation',
    )
    expect(() => convertToJsonSchema({ type: "tuple", items: "nope" }, "output", draft)).toThrow(
      /items is not an array/,
    )
    expect(() => convertToJsonSchema({ type: "union" }, "output", draft)).toThrow(
      /options is not an array/,
    )
    expect(() => convertToJsonSchema({ type: "picklist" }, "output", draft)).toThrow(
      /options is not an array/,
    )
    expect(() => convertToJsonSchema({ type: "object", entries: null }, "output", draft)).toThrow(
      /entries is not an object/,
    )
    expect(() => convertToJsonSchema({ type: "array" }, "output", draft)).toThrow(
      /item is not a schema/,
    )
    expect(() => convertToJsonSchema({ type: "record" }, "output", draft)).toThrow(
      /value is not a schema/,
    )
    expect(() => convertToJsonSchema({ type: "lazy" }, "output", draft)).toThrow(
      'tskm: cannot convert schema type "lazy" to JSON Schema: it has no getter',
    )
    expect(() => convertToJsonSchema({ type: "string", pipe: [null] }, "output", draft)).toThrow(
      "tskm: cannot convert a pipe whose base is not a schema object",
    )
    expect(() =>
      convertToJsonSchema({ type: "string", pipe: [{ type: "string" }, null] }, "output", draft),
    ).toThrow("tskm: cannot convert a non-object pipe item to JSON Schema")
    expect(() =>
      convertToJsonSchema(
        { type: "string", pipe: [{ type: "string" }, { type: "nope" }] },
        "output",
        draft,
      ),
    ).toThrow(
      'tskm: cannot convert pipe item "nope" to JSON Schema: it has no JSON Schema representation',
    )
    expect(() =>
      convertToJsonSchema(
        { type: "string", pipe: [{ type: "string" }, { type: "regex", requirement: "a" }] },
        "output",
        draft,
      ),
    ).toThrow('tskm: cannot convert pipe item "regex" to JSON Schema: requirement is not a RegExp')
    // A transform item whose `kind` is not "transformation" slips past the pipe's leading
    // transform guard, so it reaches the per-item switch, which refuses it for the same
    // reason (its output type is not reified at runtime).
    expect(() =>
      convertToJsonSchema(
        { type: "string", pipe: [{ type: "string" }, { type: "transform", kind: "other" }] },
        "output",
        draft,
      ),
    ).toThrow(
      'tskm: cannot convert pipe item "transform" to JSON Schema output: the transform\'s output type is not reified at runtime. input() still describes the schema before the transform',
    )
    expect(() => convertToJsonSchema({ type: "discriminated_union" }, "output", draft)).toThrow(
      /options is not an array/,
    )
  })

  it("ignores a non-string description and a template without a pattern", () => {
    expect(
      convertToJsonSchema(
        {
          type: "string",
          pipe: [{ type: "string" }, { type: "description", requirement: 42 }],
        },
        "output",
        draft,
      ),
    ).toEqual({ type: "string" })
    expect(convertToJsonSchema({ type: "templateLiteral", expects: 1 }, "output", draft)).toEqual({
      type: "string",
      "x-tskm-template": true,
    })
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(() =>
      convertToJsonSchema(
        { type: "optional", wrapped: { type: "string" }, default: loop },
        "input",
        draft,
      ),
    ).toThrow(
      "tskm: cannot represent a default value in JSON Schema: JSON.stringify cannot serialize cyclic structures.",
    )
  })

  it("accepts libraryOptions that carry no name", () => {
    expect(
      jsonSchema(string()).output({
        target: "draft-07",
        libraryOptions: { io: "input" },
      }),
    ).toEqual({ type: "string" })
  })
})

describe("Standard JSON Schema — ~standard shape", () => {
  it("defines ~standard as a data property that every read shares", () => {
    const cases = [
      object({ a: string() }),
      pipe(string(), minLength(1)),
      recursive((self) => object({ child: optional(self) })),
    ]
    for (const schema of cases) {
      const wrapped = withJsonSchema(schema)
      const descriptor = Object.getOwnPropertyDescriptor(wrapped, "~standard")
      expect(descriptor && "value" in descriptor).toBe(true)
      expect(descriptor?.get).toBeUndefined()
      expect(wrapped["~standard"]).toBe(wrapped["~standard"])
      expect(wrapped["~standard"].jsonSchema).toBe(wrapped["~standard"].jsonSchema)
      expect(wrapped["~standard"].validate).toBe(schema["~standard"].validate)
    }
  })

  it("keeps the base's types when the base carries them", () => {
    const types = { input: "in", output: "out" }
    const validate = (value: unknown) => ({ value })
    const base = { version: 1, vendor: "test", validate, types }
    const schema = {
      kind: "schema",
      type: "string",
      reference: string,
      expects: "string",
      async: false,
      get "~standard"() {
        return base
      },
      "~run": (dataset: unknown) => dataset,
    }
    const wrapped = withJsonSchema(schema as unknown as Parameters<typeof withJsonSchema>[0])
    expect(wrapped["~standard"].types).toBe(types)
    expect(wrapped["~standard"].version).toBe(1)
    expect(wrapped["~standard"].vendor).toBe("test")
    expect(wrapped["~standard"].validate).toBe(validate)
    expect(Object.keys(wrapped["~standard"]).sort()).toEqual([
      "jsonSchema",
      "types",
      "validate",
      "vendor",
      "version",
    ])
    expect(schema["~standard"]).toBe(base)
    expect("jsonSchema" in base).toBe(false)
  })

  it("leaves the original schema's properties and descriptors untouched", () => {
    const schema = pipe(object({ a: optional(string(), "x") }), description("doc"))
    const before: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(schema)
    const standardBefore = schema["~standard"]
    const wrapped = withJsonSchema(schema)
    wrapped["~standard"].jsonSchema.input(draft)
    wrapped["~standard"].jsonSchema.output(draft07)
    const after: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(schema)
    expect(Object.keys(after)).toEqual(Object.keys(before))
    for (const key of Object.keys(before)) {
      expect(after[key]?.get).toBe(before[key]?.get)
      expect(after[key]?.value).toBe(before[key]?.value)
    }
    expect(schema["~standard"]).toBe(standardBefore)
    expect("jsonSchema" in schema["~standard"]).toBe(false)
  })
})

describe("Standard JSON Schema — values JSON cannot carry", () => {
  // `JSON.stringify` writes NaN and the infinities as null, which is a different value. Each
  // position refuses them, and the refusal names the value.
  it("refuses a literal that is NaN or an infinity", () => {
    expect(() => output(literal(Number.POSITIVE_INFINITY))).toThrow(
      'tskm: cannot convert schema type "literal" to JSON Schema: Infinity has no JSON representation',
    )
    expect(() => output(literal(Number.NEGATIVE_INFINITY))).toThrow(/-Infinity has no JSON/)
    expect(() => output(literal(Number.NaN))).toThrow(/NaN has no JSON representation/)
    expect(() => input(literal(Number.NaN))).toThrow(/NaN has no JSON representation/)
  })

  it("refuses a bigint literal, which JSON cannot carry either", () => {
    expect(() => output(literal(1n as unknown as number))).toThrow(
      'tskm: cannot convert schema type "literal" to JSON Schema: a bigint value has no JSON representation',
    )
  })

  it("refuses a picklist option that is NaN or an infinity", () => {
    expect(() => output(picklist([1, Number.NaN]))).toThrow(
      'tskm: cannot convert schema type "picklist" option to JSON Schema: NaN has no JSON representation',
    )
    expect(() => output(picklist([Number.POSITIVE_INFINITY]))).toThrow(/Infinity has no JSON/)
  })

  it("refuses a numeric keyword whose requirement is not a finite number", () => {
    expect(() => output(pipe(number(), minValue(Number.POSITIVE_INFINITY)))).toThrow(
      'tskm: cannot convert pipe item "min_value" to JSON Schema: Infinity has no JSON representation',
    )
    expect(() => output(pipe(number(), maxValue(Number.NEGATIVE_INFINITY)))).toThrow(
      'tskm: cannot convert pipe item "max_value" to JSON Schema: -Infinity has no JSON representation',
    )
    expect(() => output(pipe(string(), minLength(Number.NaN)))).toThrow(
      'tskm: cannot convert pipe item "min_length" to JSON Schema: NaN has no JSON representation',
    )
    expect(() => output(pipe(string(), minValue("m")))).toThrow(
      'tskm: cannot convert pipe item "min_value" to JSON Schema: its requirement is of type string, not a finite number, so it has no minimum keyword',
    )
  })

  it("keeps the finite values and bounds unchanged", () => {
    expect(output(literal(0))).toEqual({ const: 0 })
    expect(output(picklist([1, -2.5, "a", true]))).toEqual({ enum: [1, -2.5, "a", true] })
    expect(output(pipe(number(), minValue(0), maxValue(10)))).toEqual({
      type: "number",
      minimum: 0,
      maximum: 10,
    })
  })

  it("names the kind of a requirement that is not a number: Date, Object, null, bigint", () => {
    // The kind is read with Object.prototype.toString for objects and typeof otherwise, so each
    // kind of requirement is its own case (a Date is not reported as an object).
    expect(() => output(pipe(string(), minValue(new Date(0) as unknown as string)))).toThrow(
      'tskm: cannot convert pipe item "min_value" to JSON Schema: its requirement is of type Date, not a finite number, so it has no minimum keyword',
    )
    expect(() => output(pipe(string(), minValue({} as unknown as string)))).toThrow(
      'tskm: cannot convert pipe item "min_value" to JSON Schema: its requirement is of type Object, not a finite number, so it has no minimum keyword',
    )
    expect(() => output(pipe(string(), minValue(null as unknown as string)))).toThrow(
      'tskm: cannot convert pipe item "min_value" to JSON Schema: its requirement is of type null, not a finite number, so it has no minimum keyword',
    )
    expect(() => output(pipe(string(), minValue(1n as unknown as string)))).toThrow(
      'tskm: cannot convert pipe item "min_value" to JSON Schema: its requirement is of type bigint, not a finite number, so it has no minimum keyword',
    )
  })

  it("names the keyword a non-number requirement would have set, for each numeric keyword", () => {
    const notANumber = (type: string, keyword: string) =>
      `tskm: cannot convert pipe item "${type}" to JSON Schema: its requirement is of type string, not a finite number, so it has no ${keyword} keyword`
    expect(() => output(pipe(number(), maxValue("9" as unknown as number)))).toThrow(
      notANumber("max_value", "maximum"),
    )
    expect(() => output(pipe(number(), multipleOf("2" as unknown as number)))).toThrow(
      notANumber("multiple_of", "multipleOf"),
    )
    expect(() => output(pipe(array(number()), length("3" as unknown as number)))).toThrow(
      notANumber("length", "minItems and maxItems"),
    )
  })
})
