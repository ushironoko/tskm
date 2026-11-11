// biome-ignore-all lint/suspicious/noTemplateCurlyInString: assertions compare against template-literal type text that contains literal "${...}"

import { resolveConfig } from "../src/config.ts"
import { jsonSchemaOutputPath, schemaToJsonSchema } from "../src/jsonschema.ts"
import { describe, expect, it } from "./test-api.ts"

// Duck-typed schema objects built inline — NOT imported from `tskm` — so the walker
// is exercised exactly as it sees a runtime schema across the package boundary.
const s = {
  string: () => ({ kind: "schema", type: "string" }),
  number: () => ({ kind: "schema", type: "number" }),
  boolean: () => ({ kind: "schema", type: "boolean" }),
  null: () => ({ kind: "schema", type: "null" }),
  literal: (literal: unknown) => ({ kind: "schema", type: "literal", literal }),
  picklist: (options: unknown[]) => ({ kind: "schema", type: "picklist", options }),
  object: (entries: Record<string, unknown>) => ({ kind: "schema", type: "object", entries }),
  array: (item: unknown) => ({ kind: "schema", type: "array", item }),
  record: (value: unknown) => ({ kind: "schema", type: "record", value }),
  tuple: (items: unknown[]) => ({ kind: "schema", type: "tuple", items }),
  union: (options: unknown[]) => ({ kind: "schema", type: "union", options }),
  optional: (wrapped: unknown) => ({ kind: "schema", type: "optional", wrapped }),
  nullable: (wrapped: unknown) => ({ kind: "schema", type: "nullable", wrapped }),
} as const

const pipe = (base: unknown, ...items: unknown[]) => ({
  ...(base as object),
  pipe: [base, ...items],
})

describe("schemaToJsonSchema — primitives", () => {
  it("maps the scalar leaf schemas", () => {
    expect(schemaToJsonSchema(s.string()).schema).toEqual({ type: "string" })
    expect(schemaToJsonSchema(s.number()).schema).toEqual({ type: "number" })
    expect(schemaToJsonSchema(s.boolean()).schema).toEqual({ type: "boolean" })
    expect(schemaToJsonSchema(s.null()).schema).toEqual({ type: "null" })
  })

  it("maps literal to const and picklist to enum", () => {
    expect(schemaToJsonSchema(s.literal("hi")).schema).toEqual({ const: "hi" })
    expect(schemaToJsonSchema(s.picklist(["a", "b"])).schema).toEqual({ enum: ["a", "b"] })
  })
})

describe("schemaToJsonSchema — object", () => {
  it("emits properties, required (excluding optional keys), additionalProperties:false", () => {
    const schema = s.object({
      id: s.string(),
      nickname: s.optional(s.string()),
    })
    const { schema: out } = schemaToJsonSchema(schema)
    expect(out).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
        nickname: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    })
  })

  it("reflects the unknown-key policy in additionalProperties (#16)", () => {
    const withRest = (rest: string) => ({
      kind: "schema",
      type: "object",
      entries: { a: s.string() },
      rest,
    })
    expect(schemaToJsonSchema(withRest("strip")).schema.additionalProperties).toBe(false)
    expect(schemaToJsonSchema(withRest("exact")).schema.additionalProperties).toBe(false)
    expect(schemaToJsonSchema(withRest("passthrough")).schema.additionalProperties).toBe(true)
  })
})

describe("schemaToJsonSchema — containers", () => {
  it("array -> items", () => {
    expect(schemaToJsonSchema(s.array(s.string())).schema).toEqual({
      type: "array",
      items: { type: "string" },
    })
  })

  it("record -> additionalProperties", () => {
    expect(schemaToJsonSchema(s.record(s.number())).schema).toEqual({
      type: "object",
      additionalProperties: { type: "number" },
    })
  })

  it("tuple -> prefixItems with items:false", () => {
    expect(schemaToJsonSchema(s.tuple([s.string(), s.number()])).schema).toEqual({
      type: "array",
      prefixItems: [{ type: "string" }, { type: "number" }],
      items: false,
    })
  })

  it("union -> anyOf", () => {
    expect(schemaToJsonSchema(s.union([s.string(), s.number()])).schema).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    })
  })

  it("nullable -> anyOf with null", () => {
    expect(schemaToJsonSchema(s.nullable(s.string())).schema).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    })
  })
})

describe("schemaToJsonSchema — pipe refinements", () => {
  it("min_length on a string -> minLength", () => {
    const schema = pipe(s.string(), {
      kind: "validation",
      type: "min_length",
      requirement: 3,
    })
    expect(schemaToJsonSchema(schema).schema).toEqual({ type: "string", minLength: 3 })
  })

  it("email -> format:email", () => {
    const schema = pipe(s.string(), { kind: "validation", type: "email" })
    expect(schemaToJsonSchema(schema).schema).toEqual({ type: "string", format: "email" })
  })

  it("integer on a number -> type:integer", () => {
    const schema = pipe(s.number(), { kind: "validation", type: "integer" })
    expect(schemaToJsonSchema(schema).schema).toEqual({ type: "integer" })
  })

  it("min_length on an array uses minItems", () => {
    const schema = pipe(s.array(s.string()), {
      kind: "validation",
      type: "min_length",
      requirement: 2,
    })
    expect(schemaToJsonSchema(schema).schema).toEqual({
      type: "array",
      items: { type: "string" },
      minItems: 2,
    })
  })

  const transformItem = {
    kind: "transformation",
    type: "transform",
    operation: (x: unknown) => x,
  }

  it("transform on the output side is an error that names the approximation and io", () => {
    const schema = pipe(s.string(), transformItem)
    const result = schemaToJsonSchema(schema, { rootName: "Account" })
    expect(result.errors).toEqual([
      'Account: cannot convert pipe item "transform" to JSON Schema output: the transform\'s output type is not reified at runtime. Add "transform" to jsonSchema.approximate (CLI: --approximate transform) to emit it as the schema before the transform instead. Or set jsonSchema.io to "input", which needs no approximation.',
    ])
    expect(result.warnings).toHaveLength(0)
  })

  it("transform approximated: the base schema stands and a note is recorded", () => {
    const schema = pipe(s.string(), transformItem)
    const result = schemaToJsonSchema(schema, { rootName: "Account", approximate: ["transform"] })
    expect(result.schema).toEqual({ type: "string" })
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toEqual([
      "Account: approximated transform as the schema before the transform.",
    ])
  })

  it("transform on the input side needs no approximation and keeps the input shape", () => {
    const schema = pipe(s.string(), transformItem)
    const result = schemaToJsonSchema(schema, { io: "input" })
    expect(result.schema).toEqual({ type: "string" })
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it("on the input side, constraints after a transform are dropped except description", () => {
    const schema = pipe(
      s.string(),
      transformItem,
      { kind: "validation", type: "min_value", requirement: 3 },
      { kind: "metadata", type: "description", requirement: "the parsed length" },
    )
    const result = schemaToJsonSchema(schema, { io: "input" })
    expect(result.schema).toEqual({ type: "string", description: "the parsed length" })
    expect(result.errors).toHaveLength(0)
  })
})

describe("schemaToJsonSchema — description metadata", () => {
  const desc = (requirement: string) => ({
    kind: "metadata",
    type: "description",
    requirement,
  })

  it("description on a string -> description keyword, no warning", () => {
    const result = schemaToJsonSchema(pipe(s.string(), desc("a plain string")))
    expect(result.schema).toEqual({ type: "string", description: "a plain string" })
    expect(result.warnings).toEqual([])
  })

  it("description on a property lands on the property, not the parent", () => {
    const schema = s.object({
      id: pipe(s.string(), desc("unique identifier")),
      name: s.string(),
    })
    const { schema: out } = schemaToJsonSchema(schema)
    expect(out).toEqual({
      type: "object",
      properties: {
        id: { type: "string", description: "unique identifier" },
        name: { type: "string" },
      },
      required: ["id", "name"],
      additionalProperties: false,
    })
  })

  it("composes with constraint actions in the same pipe", () => {
    const schema = pipe(
      s.string(),
      { kind: "validation", type: "min_length", requirement: 1 },
      desc("non-empty text"),
    )
    expect(schemaToJsonSchema(schema).schema).toEqual({
      type: "string",
      minLength: 1,
      description: "non-empty text",
    })
  })

  it("stacks last-wins when piped multiple times", () => {
    const schema = pipe(s.string(), desc("first"), desc("second"))
    expect(schemaToJsonSchema(schema).schema).toEqual({
      type: "string",
      description: "second",
    })
  })

  it("ignores a non-string requirement instead of emitting garbage", () => {
    const schema = pipe(s.string(), {
      kind: "metadata",
      type: "description",
      requirement: 42,
    })
    expect(schemaToJsonSchema(schema).schema).toEqual({ type: "string" })
  })
})

describe("schemaToJsonSchema — preprocess", () => {
  const preprocessed = { kind: "schema", type: "preprocess", wrapped: s.number() }

  it("the output side is the inner schema, with no note", () => {
    const result = schemaToJsonSchema(preprocessed)
    expect(result.schema).toEqual({ type: "number" })
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it("the input side is {} because the input type is unknown, as withJsonSchema emits", () => {
    const result = schemaToJsonSchema(preprocessed, { io: "input" })
    expect(result.schema).toEqual({})
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it("folds pipe constraints onto the inner output shape", () => {
    const schema = pipe(
      { kind: "schema", type: "preprocess", wrapped: s.number() },
      { kind: "validation", type: "min_value", requirement: 1 },
      { kind: "validation", type: "max_value", requirement: 65535 },
    )
    const result = schemaToJsonSchema(schema)
    expect(result.schema).toEqual({ type: "number", minimum: 1, maximum: 65535 })
    expect(result.errors).toHaveLength(0)
  })

  it("on the input side a piped preprocess is {} and its constraints are not applied", () => {
    const schema = pipe(
      { kind: "schema", type: "preprocess", wrapped: s.number() },
      { kind: "validation", type: "min_value", requirement: 1 },
    )
    expect(schemaToJsonSchema(schema, { io: "input" }).schema).toEqual({})
  })
})

describe("schemaToJsonSchema — fallback", () => {
  // A fallback recovers a failed parse with its value, so both sides keep the inner type.
  // The fallback value is not emitted as a `default` keyword (core emits it on the output).
  const fallbackOf = { kind: "schema", type: "fallback", wrapped: s.string(), fallback: "x" }

  it("emits the inner schema on the output side", () => {
    expect(schemaToJsonSchema(fallbackOf).schema).toEqual({ type: "string" })
  })

  it("emits the inner schema on the input side", () => {
    expect(schemaToJsonSchema(fallbackOf, { io: "input" }).schema).toEqual({ type: "string" })
  })
})

describe("schemaToJsonSchema — lazy recursion", () => {
  it("terminates a self-referential lazy and emits $ref/$defs", () => {
    // A node referencing itself through a lazy getter — the classic recursive shape.
    const node: Record<string, unknown> = { kind: "schema", type: "object" }
    const lazyNode = { kind: "schema", type: "lazy", getter: () => node }
    node.entries = {
      value: s.string(),
      next: s.optional(lazyNode),
    }

    const { schema: out } = schemaToJsonSchema(node)
    expect(out.$defs).toBeDefined()
    const defs = out.$defs as Record<string, { properties?: Record<string, { $ref?: string }> }>
    const defNames = Object.keys(defs)
    // The root participates in the cycle, so it is hoisted ONCE (not duplicated) and the
    // top-level document is a $ref into $defs.
    expect(defNames).toHaveLength(1)
    const rootRef = out.$ref as string
    expect(rootRef).toMatch(/^#\/\$defs\//)
    const rootName = rootRef.replace("#/$defs/", "")
    // The hoisted body's `next` resolves back to the SAME def (the cycle is broken).
    expect(defs[rootName]?.properties?.next?.$ref).toBe(rootRef)
  })

  it("does not stack-overflow on a non-lazy containment cycle", () => {
    // A hand-built object whose entry points back at itself (no lazy). The walker must
    // break the cycle via $ref instead of recursing forever.
    const self: Record<string, unknown> = { kind: "schema", type: "object" }
    self.entries = { me: self }
    expect(() => schemaToJsonSchema(self)).not.toThrow()
    const { schema: out } = schemaToJsonSchema(self)
    expect(out.$ref).toMatch(/^#\/\$defs\//)
  })
})

describe("schemaToJsonSchema — recursive combinator", () => {
  /** A duck-typed recursive() schema: the root IS self; getter returns the body. */
  function recursiveRoot(): Record<string, unknown> {
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    const body = {
      kind: "schema",
      type: "object",
      entries: {
        name: s.string(),
        children: { kind: "schema", type: "array", item: root },
      },
    }
    root.getter = () => body
    return root
  }

  it("terminates the self-cycle via $ref/$defs without leaking self as a spurious def", () => {
    const { schema: out, warnings } = schemaToJsonSchema(recursiveRoot())
    expect(warnings).toHaveLength(0)
    expect(out.$ref).toMatch(/^#\/\$defs\//)
    const defs = out.$defs as Record<
      string,
      { properties?: Record<string, { items?: { $ref?: string } }> }
    >
    // Exactly ONE def: the recursive root. Its body is not duplicated and the self
    // placeholder does not surface as a second definition.
    expect(Object.keys(defs)).toHaveLength(1)
    const rootRef = out.$ref as string
    const rootName = rootRef.replace("#/$defs/", "")
    expect(defs[rootName]?.properties?.children?.items?.$ref).toBe(rootRef)
  })

  it("names the hoisted def after the export-derived name when provided", () => {
    const root = recursiveRoot()
    const { schema: out } = schemaToJsonSchema(root, {
      exportNames: new Map<object, string>([[root, "Category"]]),
    })
    expect(out.$ref).toBe("#/$defs/Category")
    expect((out.$defs as Record<string, unknown>).Category).toBeDefined()
  })

  it("fully inlines a recursive() whose body never references self", () => {
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    root.getter = () => s.object({ name: s.string() })
    const { schema: out, warnings } = schemaToJsonSchema(root)
    expect(warnings).toHaveLength(0)
    expect(out.$defs).toBeUndefined()
    expect(out).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    })
  })
})

describe("schemaToJsonSchema — unrepresentable types fail by default", () => {
  const bigintType = { kind: "schema", type: "bigint" }
  const dateType = { kind: "schema", type: "date" }
  const undefinedType = { kind: "schema", type: "undefined" }

  it("bigint is an error with its path, its type, and the option that approximates it", () => {
    const r = schemaToJsonSchema(s.object({ amount: bigintType }), { rootName: "Order" })
    expect(r.errors).toEqual([
      'Order.amount: cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation. Add "bigint" to jsonSchema.approximate (CLI: --approximate bigint) to emit it as a string instead.',
    ])
    expect(r.warnings).toHaveLength(0)
  })

  it("date and undefined are errors in the same shape", () => {
    const d = schemaToJsonSchema(s.object({ createdAt: dateType }), { rootName: "User" })
    expect(d.errors).toEqual([
      'User.createdAt: cannot convert schema type "date" to JSON Schema: Date has no JSON representation. Add "date" to jsonSchema.approximate (CLI: --approximate date) to emit it as a date-time string instead.',
    ])
    const u = schemaToJsonSchema(s.object({ note: undefinedType }), { rootName: "User" })
    expect(u.errors).toEqual([
      'User.note: cannot convert schema type "undefined" to JSON Schema: undefined has no JSON representation. Add "undefined" to jsonSchema.approximate (CLI: --approximate undefined) to emit it as an unconstrained schema instead.',
    ])
  })

  it("an opted-in approximation keeps the previous output and notes each use", () => {
    const schema = s.object({ amount: bigintType, createdAt: dateType, note: undefinedType })
    const r = schemaToJsonSchema(schema, {
      rootName: "Order",
      approximate: ["bigint", "date", "undefined"],
    })
    expect(r.schema).toEqual({
      type: "object",
      properties: {
        amount: { type: "string" },
        createdAt: { type: "string", format: "date-time" },
        note: {},
      },
      required: ["amount", "createdAt", "note"],
      additionalProperties: false,
    })
    expect(r.errors).toHaveLength(0)
    expect(r.warnings).toEqual([
      "Order.amount: approximated bigint as a string.",
      "Order.createdAt: approximated date as a date-time string.",
      "Order.note: approximated undefined as an unconstrained schema.",
    ])
  })

  it("an approximation applies only to the type it names", () => {
    const schema = s.object({ amount: bigintType, createdAt: dateType })
    const r = schemaToJsonSchema(schema, { rootName: "Order", approximate: ["bigint"] })
    expect(r.warnings).toEqual(["Order.amount: approximated bigint as a string."])
    expect(r.errors).toEqual([
      'Order.createdAt: cannot convert schema type "date" to JSON Schema: Date has no JSON representation. Add "date" to jsonSchema.approximate (CLI: --approximate date) to emit it as a date-time string instead.',
    ])
  })

  it("collects every unrepresentable node in one walk instead of stopping at the first", () => {
    const schema = s.object({ amount: bigintType, createdAt: dateType, note: undefinedType })
    expect(schemaToJsonSchema(schema, { rootName: "Order" }).errors).toHaveLength(3)
  })

  it("names the path of tuple slots, array items, record values and keys, and quoted keys", () => {
    const schema = s.object({
      items: { kind: "schema", type: "tuple", items: [bigintType] },
      tags: s.array(bigintType),
      counts: s.record(dateType),
      "a-b": bigintType,
      byDate: { kind: "schema", type: "record", key: dateType, value: s.string() },
      address: s.object({ zip: bigintType }),
    })
    const paths = schemaToJsonSchema(schema, { rootName: "Order" }).errors.map(
      (error) => error.split(": ")[0],
    )
    expect(paths).toEqual([
      "Order.items[0]",
      "Order.tags[]",
      "Order.counts[]",
      'Order["a-b"]',
      "Order.byDate[key]",
      "Order.address.zip",
    ])
  })

  it("a plain happy-path schema produces no warnings and no errors", () => {
    const r = schemaToJsonSchema(s.object({ a: s.string(), b: s.number() }))
    expect(r.warnings).toHaveLength(0)
    expect(r.errors).toHaveLength(0)
  })

  it("never is representable as { not: {} } without a note", () => {
    const r = schemaToJsonSchema({ kind: "schema", type: "never" })
    expect(r.schema).toEqual({ not: {} })
    expect(r.errors).toHaveLength(0)
    expect(r.warnings).toHaveLength(0)
  })

  it("nullish is representable as null-or-inner without a note", () => {
    const r = schemaToJsonSchema({ kind: "schema", type: "nullish", wrapped: s.string() })
    expect(r.schema).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
    expect(r.warnings).toHaveLength(0)
    expect(r.errors).toHaveLength(0)
  })
})

describe("schemaToJsonSchema — templateLiteral and discriminatedUnion (#18, #15)", () => {
  it("templateLiteral maps to a string with a pattern and a vendor extension", () => {
    const tmpl = {
      kind: "schema",
      type: "templateLiteral",
      parts: ["user_", s.string()],
      pattern: "^user_[\\s\\S]*?$",
      expects: "`user_${string}`",
    }
    expect(schemaToJsonSchema(tmpl).schema).toEqual({
      type: "string",
      pattern: "^user_[\\s\\S]*?$",
      "x-tskm-template": "`user_${string}`",
    })
  })

  it("discriminatedUnion maps to oneOf with the discriminant as const", () => {
    const du = {
      kind: "schema",
      type: "discriminated_union",
      discriminant: "k",
      options: [
        s.object({ k: s.literal("c"), r: s.number() }),
        s.object({ k: s.literal("s"), side: s.number() }),
      ],
    }
    expect(schemaToJsonSchema(du).schema).toEqual({
      oneOf: [
        {
          type: "object",
          properties: { k: { const: "c" }, r: { type: "number" } },
          required: ["k", "r"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { k: { const: "s" }, side: { type: "number" } },
          required: ["k", "side"],
          additionalProperties: false,
        },
      ],
      "x-tskm-discriminant": "k",
    })
  })
})

describe("schemaToJsonSchema — keyed record (#19)", () => {
  it("an unkeyed record stays additionalProperties only", () => {
    expect(schemaToJsonSchema(s.record(s.number())).schema).toEqual({
      type: "object",
      additionalProperties: { type: "number" },
    })
  })

  it("a keyed record constrains keys via propertyNames", () => {
    const tmplKey = {
      kind: "schema",
      type: "templateLiteral",
      parts: ["item_", s.string()],
      pattern: "^item_[\\s\\S]*?$",
      expects: "`item_${string}`",
    }
    expect(
      schemaToJsonSchema({ kind: "schema", type: "record", key: tmplKey, value: s.number() })
        .schema,
    ).toEqual({
      type: "object",
      additionalProperties: { type: "number" },
      propertyNames: {
        type: "string",
        pattern: "^item_[\\s\\S]*?$",
        "x-tskm-template": "`item_${string}`",
      },
    })
  })

  it("a picklist key constrains keys via propertyNames enum", () => {
    expect(
      schemaToJsonSchema({
        kind: "schema",
        type: "record",
        key: s.picklist(["a", "b"]),
        value: s.number(),
      }).schema,
    ).toEqual({
      type: "object",
      additionalProperties: { type: "number" },
      propertyNames: { enum: ["a", "b"] },
    })
  })
})

describe("jsonSchemaOutputPath", () => {
  it("writes a sibling .json by default and into outDir when configured", () => {
    const sibling = resolveConfig({}, "/proj")
    expect(jsonSchemaOutputPath("/proj/src/account.schema.ts", sibling)).toBe(
      "/proj/src/account.schema.json",
    )
    const out = resolveConfig({ jsonSchema: { outDir: "schemas" } }, "/proj")
    expect(jsonSchemaOutputPath("/proj/src/account.schema.ts", out)).toBe(
      "/proj/schemas/account.schema.json",
    )
  })
})

describe("schemaToJsonSchema — template literals", () => {
  it("emits an anchored pattern plus the vendor extension when the schema carries one", () => {
    const withPattern = {
      kind: "schema",
      type: "templateLiteral",
      expects: "`id-${string}`",
      pattern: "^id-.*$",
    }
    expect(schemaToJsonSchema(withPattern).schema).toEqual({
      type: "string",
      pattern: "^id-.*$",
      "x-tskm-template": "`id-${string}`",
    })
  })

  it("falls back to a bare string type (no pattern) when none is present", () => {
    // A template-literal schema whose runtime `pattern` is absent still maps to a string; the
    // structural `expects` is preserved as the vendor extension so richer consumers keep it.
    const noPattern = {
      kind: "schema",
      type: "templateLiteral",
      expects: "`id-${string}`",
    }
    expect(schemaToJsonSchema(noPattern).schema).toEqual({
      type: "string",
      "x-tskm-template": "`id-${string}`",
    })
    // When even `expects` is not a string, the extension degrades to `true`.
    const bare = { kind: "schema", type: "templateLiteral" }
    expect(schemaToJsonSchema(bare).schema).toEqual({
      type: "string",
      "x-tskm-template": true,
    })
  })
})
