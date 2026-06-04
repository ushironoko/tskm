import { describe, expect, it } from "bun:test"
import { schemaToTypeString } from "../src/structural-ts.ts"

// Duck-typed schema objects built inline — NOT imported from `tskm` — so the walker
// is exercised exactly as it sees a runtime schema across the package boundary.
const s = {
  string: () => ({ kind: "schema", type: "string" }),
  number: () => ({ kind: "schema", type: "number" }),
  boolean: () => ({ kind: "schema", type: "boolean" }),
  bigint: () => ({ kind: "schema", type: "bigint" }),
  date: () => ({ kind: "schema", type: "date" }),
  null: () => ({ kind: "schema", type: "null" }),
  undefined: () => ({ kind: "schema", type: "undefined" }),
  any: () => ({ kind: "schema", type: "any" }),
  unknown: () => ({ kind: "schema", type: "unknown" }),
  never: () => ({ kind: "schema", type: "never" }),
  literal: (literal: unknown) => ({ kind: "schema", type: "literal", literal }),
  picklist: (options: unknown[]) => ({ kind: "schema", type: "picklist", options }),
  object: (entries: Record<string, unknown>) => ({ kind: "schema", type: "object", entries }),
  array: (item: unknown) => ({ kind: "schema", type: "array", item }),
  record: (value: unknown) => ({ kind: "schema", type: "record", value }),
  tuple: (items: unknown[]) => ({ kind: "schema", type: "tuple", items }),
  union: (options: unknown[]) => ({ kind: "schema", type: "union", options }),
  optional: (wrapped: unknown) => ({ kind: "schema", type: "optional", wrapped }),
  nullable: (wrapped: unknown) => ({ kind: "schema", type: "nullable", wrapped }),
  nullish: (wrapped: unknown) => ({ kind: "schema", type: "nullish", wrapped }),
} as const

const pipe = (base: unknown, ...items: unknown[]) => ({
  ...(base as object),
  pipe: [base, ...items],
})

const transform = () => ({
  kind: "transformation",
  type: "transform",
  operation: (x: unknown) => x,
})
const brand = (name: unknown) => ({ kind: "transformation", type: "brand", name })
const minLength = (n: number) => ({ kind: "validation", type: "min_length", requirement: n })

const walk = (schema: unknown, rootName = "Root", typeNames = new Map<object, string>()) =>
  schemaToTypeString(schema, { rootName, typeNames })

describe("schemaToTypeString — per-type TS bodies", () => {
  const cases: ReadonlyArray<[string, unknown, string]> = [
    ["string", s.string(), "string"],
    ["number", s.number(), "number"],
    ["boolean", s.boolean(), "boolean"],
    ["bigint", s.bigint(), "bigint"],
    ["date", s.date(), "Date"],
    ["null", s.null(), "null"],
    ["undefined", s.undefined(), "undefined"],
    ["any", s.any(), "any"],
    ["unknown", s.unknown(), "unknown"],
    ["never", s.never(), "never"],
    ["string literal", s.literal("hi"), '"hi"'],
    ["number literal", s.literal(1), "1"],
    ["boolean literal", s.literal(true), "true"],
    ["picklist", s.picklist(["a", "b"]), '"a" | "b"'],
    ["array", s.array(s.string()), "string[]"],
    [
      "array of union needs parens",
      s.array(s.union([s.string(), s.number()])),
      "(string | number)[]",
    ],
    ["record", s.record(s.number()), "{ [key: string]: number }"],
    ["tuple", s.tuple([s.string(), s.number()]), "[string, number]"],
    ["union", s.union([s.string(), s.number()]), "string | number"],
    ["optional", s.optional(s.string()), "string | undefined"],
    ["nullable", s.nullable(s.string()), "string | null"],
    ["nullish", s.nullish(s.string()), "string | null | undefined"],
    [
      // Keys stay REQUIRED: object()'s parser writes every entry key and
      // InferObjectOutput has no `?` modifier — optionality lives in the value union.
      "object with optional key keeps the key required",
      s.object({ id: s.string(), nick: s.optional(s.string()) }),
      "{ id: string; nick: string | undefined }",
    ],
    [
      "object with nullish key keeps the key required",
      s.object({ id: s.string(), alt: s.nullish(s.string()) }),
      "{ id: string; alt: string | null | undefined }",
    ],
    ["empty object", s.object({}), "{}"],
    ["validation-only pipe keeps the base type", pipe(s.string(), minLength(3)), "string"],
    [
      "brand renders a self-contained intersection",
      pipe(s.string(), brand("UserId")),
      'string & { readonly "~brand": "UserId" }',
    ],
  ]

  it.each(cases)("%s", (_label, schema, expected) => {
    const result = walk(schema)
    expect(result.typeString).toBe(expected)
    expect(result.unsupported).toBe(false)
  })
})

describe("schemaToTypeString — recursion", () => {
  /** A duck-typed recursive() schema: the root IS self; getter returns the body. */
  function categoryRoot(): Record<string, unknown> {
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

  it("materializes the self-cycle as a named back-edge (hoisted once)", () => {
    const root = categoryRoot()
    const result = walk(root, "Category", new Map<object, string>([[root, "Category"]]))
    expect(result.typeString).toBe("{ name: string; children: Category[] }")
    expect(result.bearsOpaque).toBe(false)
    expect(result.unsupported).toBe(false)
    expect(result.warnings).toHaveLength(0)
  })

  it("terminates a lazy back-edge inside a recursive body via the identity guard", () => {
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    const body = {
      kind: "schema",
      type: "object",
      entries: {
        next: s.optional({ kind: "schema", type: "lazy", getter: () => root }),
      },
    }
    root.getter = () => body
    const result = walk(root, "Node", new Map<object, string>([[root, "Node"]]))
    expect(result.typeString).toBe("{ next: Node | undefined }")
    expect(result.unsupported).toBe(false)
  })

  it("renders record(self) as an index signature (legal in a recursive alias)", () => {
    // `Record<string, Json>` would be TS2456 in a self-referential alias — type
    // arguments to another alias are resolved eagerly. The index-signature literal
    // is the deferred (legal) form, and matches how tsgo renders it.
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    root.getter = () => ({
      kind: "schema",
      type: "union",
      options: [s.string(), s.array(root), s.record(root)],
    })
    const result = walk(root, "Json", new Map<object, string>([[root, "Json"]]))
    expect(result.typeString).toBe("string | Json[] | { [key: string]: Json }")
    expect(result.unsupported).toBe(false)
  })

  it("fully inlines a recursive() whose body never references self", () => {
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    root.getter = () => s.object({ name: s.string() })
    const result = walk(root, "Plain", new Map<object, string>([[root, "Plain"]]))
    expect(result.typeString).toBe("{ name: string }")
  })

  it("short-circuits references to OTHER exported schemas by their alias name", () => {
    // Same-file mutual recursion: walking A renders `B`, not B's inlined body.
    const a: Record<string, unknown> = { kind: "schema", type: "recursive" }
    const b: Record<string, unknown> = { kind: "schema", type: "recursive" }
    a.getter = () => s.object({ b: s.optional(b) })
    b.getter = () => s.object({ a: s.optional(a) })
    const typeNames = new Map<object, string>([
      [a, "A"],
      [b, "B"],
    ])
    const resultA = schemaToTypeString(a, { rootName: "A", typeNames })
    const resultB = schemaToTypeString(b, { rootName: "B", typeNames })
    expect(resultA.typeString).toBe("{ b: B | undefined }")
    expect(resultB.typeString).toBe("{ a: A | undefined }")
    expect(resultA.unsupported).toBe(false)
  })

  it("fails closed on a recursive() root with no declared alias (imported/re-exported)", () => {
    // Simulates `treeSchema` referencing an IMPORTED (or re-exported) recursive
    // schema: the foreign root is not a declared target, so it must not be inlined
    // (docs say skip) and must never be emitted as an undeclared alias name.
    const foreign: Record<string, unknown> = { kind: "schema", type: "recursive" }
    foreign.getter = () => s.object({ name: s.string(), next: s.optional(foreign) })
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    root.getter = () => s.object({ leaf: foreign, kids: s.array(root) })
    const result = walk(root, "Tree", new Map<object, string>([[root, "Tree"]]))
    expect(result.unsupported).toBe(true)
    expect(result.warnings.some((w) => w.includes("no declared alias"))).toBe(true)
    expect(result.warnings.some((w) => w.includes(".entries[leaf]"))).toBe(true)
  })

  it("inlines a non-target helper schema that is not a recursive() root", () => {
    // Plain (acyclic) helper objects keep inlining — only deferred recursive()
    // roots without a declared alias are rejected.
    const helper = s.object({ tag: s.string() })
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    root.getter = () => s.object({ meta: helper, kids: s.array(root) })
    const result = walk(root, "Tree", new Map<object, string>([[root, "Tree"]]))
    expect(result.typeString).toBe("{ meta: { tag: string }; kids: Tree[] }")
    expect(result.unsupported).toBe(false)
  })

  it("flags a cycle through a node with no exported name as unsupported", () => {
    // Hand-built anonymous cycle: terminates, but cannot be named in v1.
    const inner: Record<string, unknown> = { kind: "schema", type: "object" }
    inner.entries = { me: inner }
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    root.getter = () => s.object({ loop: inner })
    const result = walk(root, "Root", new Map<object, string>([[root, "Root"]]))
    expect(result.unsupported).toBe(true)
    expect(result.warnings.some((w) => w.includes("cycle"))).toBe(true)
  })

  it("survives a pathological getter that returns a fresh body per call (maxDepth)", () => {
    // Fresh LAZY wrappers defeat the identity guard WITHOUT tripping the non-target
    // recursive() check; the depth fallback must stop the walk instead of hanging.
    const make = (): Record<string, unknown> => ({
      kind: "schema",
      type: "lazy",
      getter: () => s.object({ next: make() }),
    })
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    root.getter = () => s.object({ next: make() })
    const result = walk(root, "Evil", new Map<object, string>([[root, "Evil"]]))
    expect(result.unsupported).toBe(true)
    expect(result.warnings.some((w) => w.includes("depth"))).toBe(true)
  })

  it("fails closed (no hang) on fresh recursive() roots minted per getter call", () => {
    // The same pathology built from recursive() roots trips the no-declared-alias
    // guard at depth 1 — earlier and with a more precise message than maxDepth.
    const make = (): Record<string, unknown> => {
      const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
      root.getter = () => s.object({ next: make() })
      return root
    }
    const root = make()
    const result = walk(root, "Evil", new Map<object, string>([[root, "Evil"]]))
    expect(result.unsupported).toBe(true)
    expect(result.warnings.some((w) => w.includes("no declared alias"))).toBe(true)
  })
})

describe("schemaToTypeString — Tier-2 transform floor", () => {
  it("emits unknown at a transform position with a path-precise diagnostic", () => {
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    const body = {
      kind: "schema",
      type: "object",
      entries: {
        age: pipe(s.number(), transform()),
        children: { kind: "schema", type: "array", item: root },
      },
    }
    root.getter = () => body
    const result = walk(root, "Category", new Map<object, string>([[root, "Category"]]))
    expect(result.typeString).toBe("{ age: unknown; children: Category[] }")
    expect(result.bearsOpaque).toBe(true)
    expect(result.opaquePaths.some((p) => p.includes(".entries[age].pipe[1]"))).toBe(true)
    expect(result.warnings.some((w) => w.includes(".entries[age]") && w.includes("unknown"))).toBe(
      true,
    )
  })

  it("keeps brand inside a cycle as an intersection (no opaque)", () => {
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    const body = pipe(s.object({ id: s.string(), parent: s.optional(root) }), brand("Node"))
    root.getter = () => body
    const result = walk(root, "Node", new Map<object, string>([[root, "Node"]]))
    expect(result.typeString).toBe(
      '{ id: string; parent: Node | undefined } & { readonly "~brand": "Node" }',
    )
    expect(result.bearsOpaque).toBe(false)
    expect(result.dataKeys).toEqual(["id", "parent"])
  })

  it("reports the root body's own data keys for the checker cross-check", () => {
    const root: Record<string, unknown> = { kind: "schema", type: "recursive" }
    root.getter = () => s.object({ id: s.string(), name: s.string() })
    const result = walk(root, "User", new Map<object, string>([[root, "User"]]))
    expect(result.dataKeys).toEqual(["id", "name"])
  })
})
