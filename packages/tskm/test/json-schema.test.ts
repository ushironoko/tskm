// biome-ignore-all lint/suspicious/noTemplateCurlyInString: assertions compare template-literal text that contains "${...}"
import { describe, expect, it } from "bun:test"
import { convertToJsonSchema } from "../src/json-schema/convert.ts"
import { standardJsonSchemaSlot } from "../src/json-schema/slot.ts"
import "../src/json-schema.ts"
import {
  any,
  array,
  arrayAsync,
  bigint,
  boolean,
  brand,
  check,
  checkAsync,
  coerce,
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

const draft = { target: "draft-2020-12" } as const
const draft07 = { target: "draft-07" } as const
const openapi = { target: "openapi-3.0" } as const

function output(schema: {
  readonly "~standard": {
    readonly jsonSchema: {
      readonly output: (options: { readonly target: string }) => Record<string, unknown>
    }
  }
}) {
  return schema["~standard"].jsonSchema.output(draft)
}

function input(schema: {
  readonly "~standard": {
    readonly jsonSchema: {
      readonly input: (options: { readonly target: string }) => Record<string, unknown>
    }
  }
}) {
  return schema["~standard"].jsonSchema.input(draft)
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
      category["~standard"].jsonSchema.output({
        target: "draft-2020-12",
        libraryOptions: { name: "Category" },
      }).$ref,
    ).toBe("#/$defs/Category")
    const left = recursive((self) => object({ left: optional(self) }))
    const right = recursive((self) => object({ right: optional(self) }))
    const defs = output(object({ left, right })).$defs as Record<string, unknown>
    expect(Object.keys(defs).sort()).toEqual(["recursive", "recursive_2"])
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
    expect(() =>
      convertToJsonSchema(
        { type: "fallback", wrapped: { type: "string" }, fallback: undefined },
        "output",
        draft,
      ),
    ).toThrow("tskm: cannot represent a default value in JSON Schema: the default is undefined")
  })

  it("splits preprocess and coerce into an open input and a constrained output", () => {
    const schema = pipe(
      preprocess((value) => Number(value), number()),
      minValue(1),
      maxValue(9),
    )
    expect(input(schema)).toEqual({})
    expect(output(schema)).toEqual({ type: "number", minimum: 1, maximum: 9 })
    expect(input(coerce.number())).toEqual({})
    expect(output(coerce.string())).toEqual({ type: "string" })
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
    expect(schema["~standard"].jsonSchema.output(draft07)).toEqual({
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
    const json = category["~standard"].jsonSchema.output(draft07)
    expect(json.$ref).toBe("#/definitions/recursive")
    expect(json.$defs).toBeUndefined()
    expect(json.definitions).toBeDefined()
  })

  it("rewrites OpenAPI 3.0 tuples, consts, and nullable", () => {
    expect(schema["~standard"].jsonSchema.input(openapi)).toEqual({
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
    expect(schema["~standard"].jsonSchema.output(openapi).properties).toEqual(
      schema["~standard"].jsonSchema.input(openapi).properties,
    )
    expect(null_()["~standard"].jsonSchema.output(openapi)).toEqual({
      type: "string",
      nullable: true,
      enum: [null],
    })
    expect(literal(1)["~standard"].jsonSchema.output(openapi)).toEqual({
      type: "number",
      enum: [1],
    })
    expect(literal(true)["~standard"].jsonSchema.output(openapi)).toEqual({
      type: "boolean",
      enum: [true],
    })
    const category = recursive((self) => object({ name: string(), child: optional(self) }))
    const nullableCategory = nullable(category)["~standard"].jsonSchema.output(openapi)
    expect(nullableCategory.nullable).toBe(true)
    expect(nullableCategory.allOf).toEqual([{ $ref: "#/definitions/recursive" }])
    expect(nullableCategory.$ref).toBeUndefined()
    expect(union([string(), number(), null_()])["~standard"].jsonSchema.output(openapi)).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
      nullable: true,
    })
    expect(union([null_(), null_()])["~standard"].jsonSchema.output(openapi)).toEqual({
      type: "string",
      nullable: true,
      enum: [null],
    })
    expect(union([string(), number()])["~standard"].jsonSchema.output(openapi)).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    })
    expect(convertToJsonSchema({ type: "literal", literal: null }, "output", openapi)).toEqual({
      type: "string",
      nullable: true,
      enum: [null],
    })
    expect(tuple([])["~standard"].jsonSchema.output(openapi)).toEqual({
      type: "array",
      items: { anyOf: [] },
      minItems: 0,
      maxItems: 0,
    })
    expect(tuple([])["~standard"].jsonSchema.output(draft07)).toEqual({
      type: "array",
      items: [],
      additionalItems: false,
    })
  })

  it("refuses keyed records and unknown targets", () => {
    const keyed = record(picklist(["a"]), number())
    expect(() => keyed["~standard"].jsonSchema.output(openapi)).toThrow(
      'tskm: cannot convert a record key constraint to JSON Schema target "openapi-3.0": propertyNames is not part of OpenAPI 3.0',
    )
    expect(keyed["~standard"].jsonSchema.output(draft07).propertyNames).toEqual({ enum: ["a"] })
    expect(() => string()["~standard"].jsonSchema.output({ target: "draft-04" })).toThrow(
      'tskm: unsupported JSON Schema target "draft-04". Supported targets: "draft-2020-12", "draft-07", "openapi-3.0".',
    )
    expect(() => string()["~standard"].jsonSchema.input({ target: "openapi-3.1" })).toThrow(
      /openapi-3\.1/,
    )
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
      string()["~standard"].jsonSchema.input(undefined as unknown as { target: "draft-07" }),
    ).toThrow("tskm: jsonSchema options must be an object with a target")
    expect(() =>
      string()["~standard"].jsonSchema.output({
        target: "draft-07",
        libraryOptions: null as unknown as Record<string, unknown>,
      }),
    ).toThrow("tskm: jsonSchema libraryOptions must be a plain object when provided")
    expect(() =>
      string()["~standard"].jsonSchema.output({
        target: "draft-07",
        libraryOptions: ["nope"] as unknown as Record<string, unknown>,
      }),
    ).toThrow(/libraryOptions must be a plain object/)
    expect(() =>
      string()["~standard"].jsonSchema.output({
        target: "draft-07",
        libraryOptions: { name: "" },
      }),
    ).toThrow('tskm: jsonSchema libraryOptions.name must be a non-empty string without "/" or "#"')
    expect(() =>
      string()["~standard"].jsonSchema.output({
        target: "draft-07",
        libraryOptions: { name: "a/b" },
      }),
    ).toThrow(/libraryOptions\.name/)
    expect(() =>
      string()["~standard"].jsonSchema.output({
        target: "draft-07",
        libraryOptions: { name: "a#b" },
      }),
    ).toThrow(/libraryOptions\.name/)
    expect(() =>
      string()["~standard"].jsonSchema.output({
        target: "draft-07",
        libraryOptions: { name: 1 as unknown as string },
      }),
    ).toThrow(/libraryOptions\.name/)
  })

  it("throws when the converter has not been installed", () => {
    const host = globalThis as Record<symbol, unknown>
    const previous = host[standardJsonSchemaSlot]
    delete host[standardJsonSchemaSlot]
    try {
      expect(() => output(string())).toThrow(
        'tskm: Standard JSON Schema is not enabled. Import "@tskm/core/json-schema" before calling ~standard.jsonSchema.',
      )
    } finally {
      host[standardJsonSchemaSlot] = previous
    }
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
      string()["~standard"].jsonSchema.output({
        target: "draft-07",
        libraryOptions: { io: "input" },
      }),
    ).toEqual({ type: "string" })
  })
})
