import { describe, expect, it } from "bun:test"
import { resolveConfig } from "../src/config.ts"
import { jsonSchemaOutputPath, schemaToJsonSchema } from "../src/jsonschema.ts"

// Duck-typed schema builders (NOT imported from tskm) — the walker reads `.type`/
// `.entries`/`.item`/… across the package boundary, so plain shaped objects suffice.
const s = {
  string: () => ({ kind: "schema", type: "string" }),
  number: () => ({ kind: "schema", type: "number" }),
  boolean: () => ({ kind: "schema", type: "boolean" }),
  null: () => ({ kind: "schema", type: "null" }),
  any: () => ({ kind: "schema", type: "any" }),
  unknown: () => ({ kind: "schema", type: "unknown" }),
  literal: (literal: unknown) => ({ kind: "schema", type: "literal", literal }),
  object: (entries: Record<string, unknown>) => ({ kind: "schema", type: "object", entries }),
  array: (item: unknown) => ({ kind: "schema", type: "array", item }),
  record: (value: unknown) => ({ kind: "schema", type: "record", value }),
  optional: (wrapped: unknown) => ({ kind: "schema", type: "optional", wrapped }),
  nullish: (wrapped: unknown) => ({ kind: "schema", type: "nullish", wrapped }),
} as const

const pipe = (base: unknown, ...items: unknown[]) => ({
  ...(base as object),
  pipe: [base, ...items],
})

const v = (type: string, extra: Record<string, unknown> = {}) => ({
  kind: "validation",
  type,
  ...extra,
})

describe("walkSchema — passthrough and unknown branches", () => {
  it("any and unknown each collapse to an empty schema with no warnings", () => {
    const a = schemaToJsonSchema(s.any())
    expect(a.schema).toEqual({})
    expect(a.warnings).toHaveLength(0)
    const u = schemaToJsonSchema(s.unknown())
    expect(u.schema).toEqual({})
    expect(u.warnings).toHaveLength(0)
  })

  it("a top-level optional unwraps to the wrapped type", () => {
    const r = schemaToJsonSchema(s.optional(s.number()))
    expect(r.schema).toEqual({ type: "number" })
    expect(r.warnings).toHaveLength(0)
  })

  it("an unknown schema type warns and emits {}", () => {
    const r = schemaToJsonSchema({ kind: "schema", type: "weird-thing" })
    expect(r.schema).toEqual({})
    expect(r.warnings.some((w) => w.includes('unknown schema type "weird-thing"'))).toBe(true)
  })

  it("a non-object top-level schema warns and emits {}", () => {
    const r = schemaToJsonSchema(42)
    expect(r.schema).toEqual({})
    expect(r.warnings.some((w) => w.includes("cannot convert non-object schema"))).toBe(true)
  })

  it("a null top-level schema warns and emits {}", () => {
    const r = schemaToJsonSchema(null)
    expect(r.schema).toEqual({})
    expect(r.warnings.some((w) => w.includes("cannot convert non-object schema"))).toBe(true)
  })
})

describe("walkSchema — literal of non-string values", () => {
  it("literal of number, boolean, and null map to const", () => {
    expect(schemaToJsonSchema(s.literal(7)).schema).toEqual({ const: 7 })
    expect(schemaToJsonSchema(s.literal(true)).schema).toEqual({ const: true })
    expect(schemaToJsonSchema(s.literal(null)).schema).toEqual({ const: null })
  })
})

describe("walkSchema — tuple/union with malformed item arrays", () => {
  it("tuple with a non-array items field falls back to empty prefixItems", () => {
    const r = schemaToJsonSchema({ kind: "schema", type: "tuple", items: "nope" })
    expect(r.schema).toEqual({ type: "array", prefixItems: [], items: false })
  })

  it("union with a non-array options field falls back to empty anyOf", () => {
    const r = schemaToJsonSchema({ kind: "schema", type: "union", options: undefined })
    expect(r.schema).toEqual({ anyOf: [] })
  })
})

describe("walkObject — optional/nullish keys are excluded from required", () => {
  it("a nullish key is treated like optional (dropped from required)", () => {
    const schema = s.object({
      id: s.string(),
      tag: s.nullish(s.string()),
    })
    const r = schemaToJsonSchema(schema)
    expect(r.schema).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
        tag: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["id"],
      additionalProperties: false,
    })
    // nullish still warns about dropping `undefined`.
    expect(r.warnings.some((w) => w.includes("undefined"))).toBe(true)
  })

  it("object with non-object entries field treats entries as empty", () => {
    const r = schemaToJsonSchema({ kind: "schema", type: "object", entries: "nope" })
    expect(r.schema).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    })
  })

  it("optional nested inside an array unwraps the item type", () => {
    const r = schemaToJsonSchema(s.array(s.optional(s.string())))
    expect(r.schema).toEqual({ type: "array", items: { type: "string" } })
  })

  it("optional nested inside a record unwraps the value type", () => {
    const r = schemaToJsonSchema(s.record(s.optional(s.number())))
    expect(r.schema).toEqual({ type: "object", additionalProperties: { type: "number" } })
  })
})

describe("walkPipe / applyItem — every representable refinement", () => {
  it("max_length on a string -> maxLength", () => {
    const r = schemaToJsonSchema(pipe(s.string(), v("max_length", { requirement: 9 })))
    expect(r.schema).toEqual({ type: "string", maxLength: 9 })
  })

  it("max_length on an array -> maxItems", () => {
    const r = schemaToJsonSchema(pipe(s.array(s.string()), v("max_length", { requirement: 5 })))
    expect(r.schema).toEqual({ type: "array", items: { type: "string" }, maxItems: 5 })
  })

  it("length on a string sets both minLength and maxLength", () => {
    const r = schemaToJsonSchema(pipe(s.string(), v("length", { requirement: 4 })))
    expect(r.schema).toEqual({ type: "string", minLength: 4, maxLength: 4 })
  })

  it("length on an array sets both minItems and maxItems", () => {
    const r = schemaToJsonSchema(pipe(s.array(s.number()), v("length", { requirement: 2 })))
    expect(r.schema).toEqual({
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
    })
  })

  it("non_empty on a string -> minLength:1", () => {
    const r = schemaToJsonSchema(pipe(s.string(), v("non_empty")))
    expect(r.schema).toEqual({ type: "string", minLength: 1 })
  })

  it("non_empty on an array -> minItems:1", () => {
    const r = schemaToJsonSchema(pipe(s.array(s.string()), v("non_empty")))
    expect(r.schema).toEqual({ type: "array", items: { type: "string" }, minItems: 1 })
  })

  it("min_value -> minimum", () => {
    const r = schemaToJsonSchema(pipe(s.number(), v("min_value", { requirement: 0 })))
    expect(r.schema).toEqual({ type: "number", minimum: 0 })
  })

  it("max_value -> maximum", () => {
    const r = schemaToJsonSchema(pipe(s.number(), v("max_value", { requirement: 100 })))
    expect(r.schema).toEqual({ type: "number", maximum: 100 })
  })

  it("multiple_of -> multipleOf", () => {
    const r = schemaToJsonSchema(pipe(s.number(), v("multiple_of", { requirement: 3 })))
    expect(r.schema).toEqual({ type: "number", multipleOf: 3 })
  })

  it("url -> format:uri", () => {
    const r = schemaToJsonSchema(pipe(s.string(), v("url")))
    expect(r.schema).toEqual({ type: "string", format: "uri" })
  })

  it("regex with a RegExp requirement -> pattern from its source", () => {
    const r = schemaToJsonSchema(pipe(s.string(), v("regex", { requirement: /^[a-z]+$/ })))
    expect(r.schema).toEqual({ type: "string", pattern: "^[a-z]+$" })
  })

  it("regex with a non-RegExp requirement is silently ignored (no pattern)", () => {
    const r = schemaToJsonSchema(pipe(s.string(), v("regex", { requirement: "not-a-regex" })))
    expect(r.schema).toEqual({ type: "string" })
    expect(r.warnings).toHaveLength(0)
  })

  it("regex with an object requirement whose source is not a string is ignored", () => {
    const r = schemaToJsonSchema(pipe(s.string(), v("regex", { requirement: { source: 123 } })))
    expect(r.schema).toEqual({ type: "string" })
    expect(r.warnings).toHaveLength(0)
  })

  it("integer applied to an already-integer base keeps type:integer", () => {
    const r = schemaToJsonSchema(pipe(s.number(), v("integer"), v("min_value", { requirement: 1 })))
    expect(r.schema).toEqual({ type: "integer", minimum: 1 })
  })

  it("multiple stacked refinements all fold onto one schema", () => {
    const r = schemaToJsonSchema(
      pipe(
        s.string(),
        v("min_length", { requirement: 2 }),
        v("max_length", { requirement: 8 }),
        v("email"),
      ),
    )
    expect(r.schema).toEqual({ type: "string", minLength: 2, maxLength: 8, format: "email" })
  })

  it("a non-object pipe item is skipped without warning", () => {
    const base = s.string()
    const schema = { ...base, pipe: [base, "junk", 7, null] }
    const r = schemaToJsonSchema(schema)
    expect(r.schema).toEqual({ type: "string" })
    expect(r.warnings).toHaveLength(0)
  })

  it("an unrepresentable pipe item warns and is skipped", () => {
    const r = schemaToJsonSchema(pipe(s.string(), v("starts_with", { requirement: "x" })))
    expect(r.schema).toEqual({ type: "string" })
    expect(r.warnings.some((w) => w.includes('pipe item "starts_with"'))).toBe(true)
  })
})

describe("walkLazy — degenerate getters", () => {
  it("a lazy schema with no getter warns and emits {}", () => {
    const r = schemaToJsonSchema({ kind: "schema", type: "lazy" })
    expect(r.schema).toEqual({})
    expect(r.warnings.some((w) => w.includes("lazy schema has no getter"))).toBe(true)
  })

  it("a lazy schema whose getter is not a function warns and emits {}", () => {
    const r = schemaToJsonSchema({ kind: "schema", type: "lazy", getter: 123 })
    expect(r.schema).toEqual({})
    expect(r.warnings.some((w) => w.includes("lazy schema has no getter"))).toBe(true)
  })

  it("a lazy schema getter that returns a plain leaf inlines it", () => {
    const r = schemaToJsonSchema({ kind: "schema", type: "lazy", getter: () => s.string() })
    expect(r.schema).toEqual({ type: "string" })
    expect(r.warnings).toHaveLength(0)
  })
})

describe("schemaToJsonSchema — multiple distinct cyclic defs and name collisions", () => {
  it("two separate self-cycles of the same base type get distinct $defs names", () => {
    const a: Record<string, unknown> = { kind: "schema", type: "object" }
    a.entries = { self: a, label: s.string() }
    const b: Record<string, unknown> = { kind: "schema", type: "object" }
    b.entries = { self: b, count: s.number() }

    const root = s.object({ a, b })
    const { schema: out } = schemaToJsonSchema(root)

    const defs = out.$defs as Record<string, unknown>
    expect(defs).toBeDefined()
    // Two independent object cycles -> two distinct names (collision suffixing kicks in).
    expect(Object.keys(defs).length).toBe(2)
    expect(Object.keys(defs).some((n) => n === "object")).toBe(true)
    expect(Object.keys(defs).some((n) => /^object_\d+$/.test(n))).toBe(true)
  })

  it("a node revisited acyclically (shared, not cyclic) is inlined, not hoisted", () => {
    const shared = s.string()
    const root = s.object({ x: shared, y: shared })
    const { schema: out } = schemaToJsonSchema(root)
    // `shared` is left the `visiting` set before the second visit, so no $defs is created.
    expect(out.$defs).toBeUndefined()
    const props = out.properties as Record<string, unknown>
    expect(props.x).toEqual({ type: "string" })
    expect(props.y).toEqual({ type: "string" })
  })

  it("re-walking the SAME root twice each produce a hoisted $ref independently", () => {
    const self: Record<string, unknown> = { kind: "schema", type: "object" }
    self.entries = { me: self }
    const first = schemaToJsonSchema(self)
    const second = schemaToJsonSchema(self)
    expect(first.schema.$ref).toMatch(/^#\/\$defs\//)
    expect(second.schema.$ref).toMatch(/^#\/\$defs\//)
  })
})

describe("jsonSchemaOutputPath — outDir vs default and nested paths", () => {
  it("default (no outDir) writes a sibling .json next to a nested source", () => {
    const cfg = resolveConfig({}, "/proj")
    expect(jsonSchemaOutputPath("/proj/src/models/user.ts", cfg)).toBe("/proj/src/models/user.json")
  })

  it("outDir flattens nested sources to basename under <root>/<outDir>", () => {
    const cfg = resolveConfig({ jsonSchema: { outDir: "out/schemas" } }, "/proj")
    expect(jsonSchemaOutputPath("/proj/src/deep/nested/account.ts", cfg)).toBe(
      "/proj/out/schemas/account.json",
    )
  })

  it("a .schema.ts source becomes .schema.json (only the trailing .ts is replaced)", () => {
    const cfg = resolveConfig({}, "/proj")
    expect(jsonSchemaOutputPath("/proj/src/account.schema.ts", cfg)).toBe(
      "/proj/src/account.schema.json",
    )
  })

  it("a source without a .ts extension is left unchanged in default mode", () => {
    const cfg = resolveConfig({}, "/proj")
    expect(jsonSchemaOutputPath("/proj/src/account", cfg)).toBe("/proj/src/account")
  })

  it("outDir is resolved relative to the config root", () => {
    const cfg = resolveConfig({ jsonSchema: { outDir: "gen" } }, "/workspace/app")
    expect(jsonSchemaOutputPath("/workspace/app/src/a/b/c.ts", cfg)).toBe(
      "/workspace/app/gen/c.json",
    )
  })
})
