import { describe, expect, it } from "bun:test"
import type { GenericSchema, UnknownDataset } from "../src/index.ts"
import {
  discriminatedUnionAsync,
  literal,
  number,
  object,
  objectAsync,
  picklist,
  pipeAsync,
  safeParseAsync,
  string,
  transformAsync,
  union,
} from "../src/index.ts"

/**
 * Async parity for `discriminatedUnion` (issue #15): O(1) tag dispatch, an authoritative
 * discriminant, the tag -> member mapping, construction guards, and the warning channel,
 * all mirrored on `discriminatedUnionAsync` so a regression is caught here too.
 */
describe("discriminatedUnionAsync runtime (#15 async parity)", () => {
  const shape = discriminatedUnionAsync("kind", [
    object({ kind: literal("circle"), radius: number() }),
    objectAsync({ kind: literal("square"), side: number() }),
  ])

  it("exposes discriminant, literals, and the tag -> member mapping", () => {
    expect(shape.discriminant).toBe("kind")
    expect(shape.literals).toEqual(["circle", "square"])
    expect(shape.mapping.get("circle")).toBe(shape.options[0])
    expect(shape.mapping.get("square")).toBe(shape.options[1])
    expect(shape.mapping.get("triangle")).toBeUndefined()
  })

  it("awaits the member selected by the tag (sync and async members)", async () => {
    expect((await safeParseAsync(shape, { kind: "circle", radius: 3 })).success).toBe(true)
    expect((await safeParseAsync(shape, { kind: "square", side: 2 })).success).toBe(true)
  })

  it("rejects an unknown tag authoritatively", async () => {
    const r = await safeParseAsync(shape, { kind: "triangle" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toContain('kind = "circle" | "square"')
    }
  })

  it("reports an in-member violation with the member's path", async () => {
    const r = await safeParseAsync(shape, { kind: "circle", radius: "x" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.path).toEqual([{ key: "radius" }])
    }
  })

  it("rejects a non-object input", async () => {
    expect((await safeParseAsync(shape, 5)).success).toBe(false)
    expect((await safeParseAsync(shape, null)).success).toBe(false)
  })

  it("only awaits the selected member (O(1) dispatch)", async () => {
    let touched = 0
    const a = object({ kind: literal("a"), y: number() })
    const b = object({ kind: literal("b"), x: number() })
    const origRun = b["~run"]
    ;(b as { "~run": unknown })["~run"] = (d: never, c: never) => {
      touched++
      return origRun(d, c)
    }
    const du = discriminatedUnionAsync("kind", [a, b])
    await safeParseAsync(du, { kind: "a", y: 1 })
    expect(touched).toBe(0)
  })

  it("supports a picklist discriminant mapping several tags to one member", async () => {
    const ab = object({ kind: picklist(["a", "b"]), x: number() })
    const c = object({ kind: literal("c"), y: number() })
    const du = discriminatedUnionAsync("kind", [ab, c])
    expect(du.literals).toEqual(["a", "b", "c"])
    expect(du.mapping.get("a")).toBe(ab)
    expect(du.mapping.get("b")).toBe(ab)
    expect((await safeParseAsync(du, { kind: "a", x: 1 })).success).toBe(true)
  })

  it("throws at construction on a duplicate tag", () => {
    expect(() =>
      discriminatedUnionAsync("kind", [
        object({ kind: literal("x"), a: number() }),
        object({ kind: literal("x"), b: number() }),
      ]),
    ).toThrow()
  })

  it("throws at construction when a member lacks the discriminant", () => {
    expect(() => discriminatedUnionAsync("kind", [object({ a: number() })])).toThrow()
  })

  it("throws at construction when the discriminant is not a literal/picklist", () => {
    expect(() =>
      discriminatedUnionAsync("kind", [object({ kind: number(), a: number() })]),
    ).toThrow()
  })

  it("carries a member warning through the async path", async () => {
    const warned = pipeAsync(
      string(),
      transformAsync(async (value: string, ctx) => {
        ctx.issue("deprecated tag payload", "warning")
        return value
      }),
    )
    const du = discriminatedUnionAsync("kind", [
      objectAsync({ kind: literal("a"), name: warned }),
      object({ kind: literal("b"), n: number() }),
    ])
    const ok = await safeParseAsync(du, { kind: "a", name: "x" })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.warnings).toHaveLength(1)
    }
    const bad = await safeParseAsync(du, { kind: "b", n: "x" })
    expect(bad.success).toBe(false)
  })

  it("exposes the schema composition metadata", () => {
    expect(shape.kind).toBe("schema")
    expect(shape.type).toBe("discriminated_union")
    expect(shape.async).toBe(true)
    expect(shape.expects).toBe("Object | Object")
  })

  it.each([
    [5],
    ["five"],
    [true],
    [undefined],
    [null],
    [[1]],
  ])("reports a schema-kind Object issue for the non-object input %o", async (input) => {
    const r = await safeParseAsync(shape, input)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.kind).toBe("schema")
      expect(r.issues[0]?.type).toBe("discriminated_union")
      expect(r.issues[0]?.expected).toBe("Object")
    }
  })

  it("reports the unknown tag as a schema-kind discriminated_union issue", async () => {
    const r = await safeParseAsync(shape, { kind: "triangle" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.kind).toBe("schema")
      expect(r.issues[0]?.type).toBe("discriminated_union")
      expect(r.issues[0]?.expected).toContain('kind = "circle" | "square"')
    }
  })

  it("formats non-string tags without quotes in the unknown-tag message", async () => {
    const du = discriminatedUnionAsync("level", [
      object({ level: literal(1), a: number() }),
      objectAsync({ level: literal(2), b: number() }),
    ])
    const r = await safeParseAsync(du, { level: 3 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toContain("level = 1 | 2")
    }
  })

  it("names the missing discriminant key in the construction error", () => {
    expect(() => discriminatedUnionAsync("kind", [object({ a: number() })])).toThrow(
      'missing the discriminant key "kind"',
    )
  })

  // `union` also carries an array `options` field, but only a real picklist may supply tags.
  it.each<[string, GenericSchema]>([
    ["number", number()],
    ["string", string()],
    ["union", union([literal("a"), literal("b")])],
  ])("rejects a %s discriminant entry with the literal/picklist error", (_entryType, entry) => {
    expect(() => discriminatedUnionAsync("kind", [object({ kind: entry, a: number() })])).toThrow(
      "must be a literal or picklist",
    )
  })

  it("formats a non-string duplicate tag without quotes in the construction error", () => {
    expect(() =>
      discriminatedUnionAsync("level", [
        object({ level: literal(1), a: number() }),
        objectAsync({ level: literal(1), b: number() }),
      ]),
    ).toThrow("duplicate discriminant value 1")
  })

  it("appends member issues after issues already present on the dataset", async () => {
    const prior = await safeParseAsync(string(), 1)
    if (prior.success) throw new Error("expected a failing prior parse")
    // `UnknownDataset` types `issues` as absent, but `~run` mutates whatever dataset its
    // caller threads through, so issues accumulated upstream must survive the member merge.
    const dataset = {
      typed: false,
      value: { kind: "circle", radius: "x" },
      issues: [...prior.issues],
    } as unknown as UnknownDataset
    const out = await shape["~run"](dataset, {})
    expect(out.issues).toHaveLength(2)
    expect(out.issues?.[0]).toBe(prior.issues[0])
    expect(out.issues?.[1]?.path).toEqual([{ key: "radius" }])
  })
})
