// biome-ignore-all lint/suspicious/noTemplateCurlyInString: assertions compare against template-literal type text that contains literal "${...}"
import { describe, expect, it } from "bun:test"
import { resolveConfig } from "../src/config.ts"
import { jsonSchemaOutputPath, schemaToJsonSchema } from "../src/jsonschema.ts"

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

  it("transform -> warning + constraint skipped", () => {
    const schema = pipe(s.string(), {
      kind: "transformation",
      type: "transform",
      operation: (x: unknown) => x,
    })
    const result = schemaToJsonSchema(schema)
    expect(result.schema).toEqual({ type: "string" })
    expect(result.warnings.length).toBeGreaterThan(0)
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

describe("schemaToJsonSchema — lossy primitives warn", () => {
  it("bigint, date, undefined, never each warn or fall back as specified", () => {
    expect(schemaToJsonSchema({ kind: "schema", type: "bigint" }).warnings).not.toHaveLength(0)
    const date = schemaToJsonSchema({ kind: "schema", type: "date" })
    expect(date.schema).toEqual({ type: "string", format: "date-time" })
    expect(date.warnings).not.toHaveLength(0)
    expect(schemaToJsonSchema({ kind: "schema", type: "undefined" }).warnings).not.toHaveLength(0)
    expect(schemaToJsonSchema({ kind: "schema", type: "never" }).schema).toEqual({ not: {} })
  })

  it("a plain happy-path schema produces no warnings", () => {
    const { warnings } = schemaToJsonSchema(s.object({ a: s.string(), b: s.number() }))
    expect(warnings).toHaveLength(0)
  })

  it("nullish warns that `undefined` cannot be expressed", () => {
    const r = schemaToJsonSchema({ kind: "schema", type: "nullish", wrapped: s.string() })
    expect(r.schema).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
    expect(r.warnings.some((w) => w.includes("undefined"))).toBe(true)
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
