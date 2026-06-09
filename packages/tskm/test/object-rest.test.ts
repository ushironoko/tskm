import { describe, expect, it } from "bun:test"
import {
  exactObject,
  exactObjectAsync,
  literal,
  object,
  objectAsync,
  parse,
  safeParse,
  safeParseAsync,
  string,
  union,
} from "../src/index.ts"

/**
 * Object unknown-key policy (issue #16): strip (default), exact (reject), passthrough (keep).
 */
describe("object unknown-key policy (#16)", () => {
  it("strip (default) drops undeclared keys, unchanged", () => {
    expect(parse(object({ a: string() }), { a: "x", extra: 1 })).toEqual({ a: "x" })
  })

  it("exactObject rejects an undeclared key with a path-precise issue", () => {
    const r = safeParse(exactObject({ a: string() }), { a: "x", extra: 1 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.path).toEqual([{ key: "extra" }])
      expect(r.issues[0]?.message).toContain("extra")
    }
  })

  it("exactObject accepts an exact match", () => {
    expect(safeParse(exactObject({ a: string() }), { a: "x" }).success).toBe(true)
  })

  it("exact mode reports every undeclared key (no abortEarly)", () => {
    const r = safeParse(exactObject({ a: string() }), { a: "x", e1: 1, e2: 2 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues.length).toBe(2)
    }
  })

  it("passthrough copies undeclared keys onto the output", () => {
    // The output TYPE is the closed shape (passthrough's extra keys are a deliberate safe
    // under-description), so the runtime extra keys are read through a widened view.
    const out = parse(object({ a: string() }, { rest: "passthrough" }), {
      a: "x",
      extra: 1,
    }) as Record<string, unknown>
    expect(out).toEqual({ a: "x", extra: 1 })
  })

  it("makes a discriminated union member sound (issue #16 repro)", () => {
    const a = exactObject({ kind: literal("a") })
    const b = object({ kind: literal("b"), extra: string() })
    const u = union([a, b])
    // Input meant for `b`: with `exactObject(a)`, the loose member no longer absorbs it.
    expect(safeParse(u, { kind: "b", extra: "x" }).success).toBe(true)
    expect(safeParse(u, { kind: "a" }).success).toBe(true)
  })

  it("passthrough is prototype-safe for a __proto__ input key", () => {
    const input = JSON.parse('{"a":"x","__proto__":{"polluted":1}}')
    const out = parse(object({ a: string() }, { rest: "passthrough" }), input) as Record<
      string,
      unknown
    >
    // The key is copied as an OWN property, not folded into the prototype.
    expect(Object.hasOwn(out, "__proto__")).toBe(true)
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })

  it("exact mode flags only own (not inherited) entry keys", () => {
    // Declared entries via a prototype: only `own` is a real declared key.
    const entries = Object.create({ inherited: string() })
    entries.own = string()
    const schema = exactObject(entries)
    // `inherited` is on the prototype, so it is treated as undeclared, not silently allowed.
    expect(safeParse(schema, { own: "x" }).success).toBe(true)
  })

  it("async: exactObjectAsync rejects, passthrough keeps", async () => {
    expect(
      (await safeParseAsync(exactObjectAsync({ a: string() }), { a: "x", e: 1 })).success,
    ).toBe(false)
    const pass = await safeParseAsync(objectAsync({ a: string() }, { rest: "passthrough" }), {
      a: "x",
      e: 1,
    })
    expect(pass.success).toBe(true)
    if (pass.success) {
      expect(pass.output as Record<string, unknown>).toEqual({ a: "x", e: 1 })
    }
  })
})
