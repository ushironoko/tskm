import { describe, expect, it } from "bun:test"
import type { GenericSchema, UnknownDataset } from "../src/index.ts"
import {
  discriminatedUnion,
  literal,
  number,
  object,
  picklist,
  pipe,
  safeParse,
  string,
  transform,
  union,
} from "../src/index.ts"

/**
 * Runtime behavior of `discriminatedUnion` (issue #15): O(1) tag dispatch, an
 * authoritative discriminant, and discriminant/literals metadata on the schema value.
 */
describe("discriminatedUnion runtime (#15)", () => {
  const shape = discriminatedUnion("kind", [
    object({ kind: literal("circle"), radius: number() }),
    object({ kind: literal("square"), side: number() }),
  ])

  it("exposes discriminant and literals metadata", () => {
    expect(shape.discriminant).toBe("kind")
    expect(shape.literals).toEqual(["circle", "square"])
  })

  it("dispatches to the member selected by the tag", () => {
    expect(safeParse(shape, { kind: "circle", radius: 3 }).success).toBe(true)
    expect(safeParse(shape, { kind: "square", side: 2 }).success).toBe(true)
  })

  it("rejects an unknown tag authoritatively", () => {
    const r = safeParse(shape, { kind: "triangle" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toContain('kind = "circle" | "square"')
    }
  })

  it("reports an in-member violation with the member's path", () => {
    const r = safeParse(shape, { kind: "circle", radius: "x" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.path).toEqual([{ key: "radius" }])
    }
  })

  it("rejects a non-object input", () => {
    expect(safeParse(shape, 5).success).toBe(false)
    expect(safeParse(shape, null).success).toBe(false)
  })

  it("only validates the selected member (O(1) dispatch)", () => {
    let touched = 0
    const a = object({ kind: literal("a"), y: number() })
    const b = object({ kind: literal("b"), x: number() })
    const origRun = b["~run"]
    ;(b as { "~run": unknown })["~run"] = (d: never, c: never) => {
      touched++
      return origRun(d, c)
    }
    const du = discriminatedUnion("kind", [a, b])
    safeParse(du, { kind: "a", y: 1 })
    expect(touched).toBe(0)
  })

  it("supports a picklist discriminant mapping several tags to one member", () => {
    const du = discriminatedUnion("kind", [
      object({ kind: picklist(["a", "b"]), x: number() }),
      object({ kind: literal("c"), y: number() }),
    ])
    expect(du.literals).toEqual(["a", "b", "c"])
    expect(safeParse(du, { kind: "a", x: 1 }).success).toBe(true)
    expect(safeParse(du, { kind: "b", x: 1 }).success).toBe(true)
  })

  it("throws at construction on a duplicate tag", () => {
    expect(() =>
      discriminatedUnion("kind", [
        object({ kind: literal("x"), a: number() }),
        object({ kind: literal("x"), b: number() }),
      ]),
    ).toThrow()
  })

  it("throws at construction when a member lacks the discriminant", () => {
    expect(() => discriminatedUnion("kind", [object({ a: number() })])).toThrow()
  })

  it("throws at construction when the discriminant is not a literal/picklist", () => {
    expect(() => discriminatedUnion("kind", [object({ kind: number(), a: number() })])).toThrow()
  })

  it("rejects a missing discriminant key at runtime (same path as an unknown tag)", () => {
    const r = safeParse(shape, { radius: 3 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toContain('kind = "circle" | "square"')
    }
  })

  it("exposes a tag -> member mapping a consumer can read to build a registry", () => {
    const circle = object({ kind: literal("circle"), radius: number() })
    const square = object({ kind: literal("square"), side: number() })
    const du = discriminatedUnion("kind", [circle, square])
    expect(du.mapping.get("circle")).toBe(circle)
    expect(du.mapping.get("square")).toBe(square)
    expect(du.mapping.get("triangle")).toBeUndefined()
    expect([...du.mapping.keys()]).toEqual(["circle", "square"])
  })

  it("expands a picklist discriminant in the mapping (every tag keys the same member)", () => {
    const ab = object({ kind: picklist(["a", "b"]), x: number() })
    const c = object({ kind: literal("c"), y: number() })
    const du = discriminatedUnion("kind", [ab, c])
    expect(du.mapping.get("a")).toBe(ab)
    expect(du.mapping.get("b")).toBe(ab)
    expect(du.mapping.get("c")).toBe(c)
  })

  it("carries a member warning (selected member only): warning succeeds, error fails", () => {
    const warned = pipe(
      string(),
      transform((value: string, ctx) => {
        ctx.issue("deprecated tag payload", "warning")
        return value
      }),
    )
    const du = discriminatedUnion("kind", [
      object({ kind: literal("a"), name: warned }),
      object({ kind: literal("b"), n: number() }),
    ])
    const ok = safeParse(du, { kind: "a", name: "x" })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.warnings).toHaveLength(1)
    }
    const bad = safeParse(du, { kind: "b", n: "x" })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "n" }])
    }
  })

  it("exposes the schema composition metadata", () => {
    expect(shape.kind).toBe("schema")
    expect(shape.type).toBe("discriminated_union")
    expect(shape.async).toBe(false)
    expect(shape.expects).toBe("Object | Object")
  })

  it.each([
    [5],
    ["five"],
    [true],
    [undefined],
    [null],
    [[1]],
  ])("reports a schema-kind Object issue for the non-object input %o", (input) => {
    const r = safeParse(shape, input)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.kind).toBe("schema")
      expect(r.issues[0]?.type).toBe("discriminated_union")
      expect(r.issues[0]?.expected).toBe("Object")
    }
  })

  it("reports the unknown tag as a schema-kind discriminated_union issue", () => {
    const r = safeParse(shape, { kind: "triangle" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.kind).toBe("schema")
      expect(r.issues[0]?.type).toBe("discriminated_union")
      expect(r.issues[0]?.expected).toContain('kind = "circle" | "square"')
    }
  })

  it("formats non-string tags without quotes in the unknown-tag message", () => {
    const du = discriminatedUnion("level", [
      object({ level: literal(1), a: number() }),
      object({ level: literal(2), b: number() }),
    ])
    const r = safeParse(du, { level: 3 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toContain("level = 1 | 2")
    }
  })

  it("names the missing discriminant key in the construction error", () => {
    expect(() => discriminatedUnion("kind", [object({ a: number() })])).toThrow(
      'missing the discriminant key "kind"',
    )
  })

  // `union` also carries an array `options` field, but only a real picklist may supply tags.
  it.each<[string, GenericSchema]>([
    ["number", number()],
    ["string", string()],
    ["union", union([literal("a"), literal("b")])],
  ])("rejects a %s discriminant entry with the literal/picklist error", (_entryType, entry) => {
    expect(() => discriminatedUnion("kind", [object({ kind: entry, a: number() })])).toThrow(
      "must be a literal or picklist",
    )
  })

  it("formats a non-string duplicate tag without quotes in the construction error", () => {
    expect(() =>
      discriminatedUnion("level", [
        object({ level: literal(1), a: number() }),
        object({ level: literal(1), b: number() }),
      ]),
    ).toThrow("duplicate discriminant value 1")
  })

  it("appends member issues after issues already present on the dataset", () => {
    const prior = safeParse(string(), 1)
    if (prior.success) throw new Error("expected a failing prior parse")
    // `UnknownDataset` types `issues` as absent, but `~run` mutates whatever dataset its
    // caller threads through, so issues accumulated upstream must survive the member merge.
    const dataset = {
      typed: false,
      value: { kind: "circle", radius: "x" },
      issues: [...prior.issues],
    } as unknown as UnknownDataset
    const out = shape["~run"](dataset, {})
    expect(out.issues).toHaveLength(2)
    expect(out.issues?.[0]).toBe(prior.issues[0])
    expect(out.issues?.[1]?.path).toEqual([{ key: "radius" }])
  })
})
