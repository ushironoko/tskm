import { describe, expect, it } from "bun:test"
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
})
