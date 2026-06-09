import { describe, expect, it } from "bun:test"
import {
  number,
  picklist,
  pipe,
  record,
  regex,
  safeParse,
  string,
  templateLiteral,
} from "../src/index.ts"

/**
 * Key schema argument to `record` (issue #19): `record(key, value)` validates each key
 * through the key schema. `record(value)` is unchanged.
 */
describe("keyed record runtime (#19)", () => {
  it("record(value) is unchanged and has no key schema", () => {
    expect(safeParse(record(number()), { a: 1 }).success).toBe(true)
    expect(safeParse(record(number()), { a: "x" }).success).toBe(false)
    expect(record(number()).key).toBeUndefined()
  })

  it("record(value, message) keeps the trailing message disambiguation", () => {
    const r = safeParse(record(number(), "nope"), 5)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("nope")
    }
  })

  it("a picklist key rejects an out-of-set key with the key on the path", () => {
    const r = record(picklist(["a", "b"]), number())
    expect(safeParse(r, { a: 1, b: 2 }).success).toBe(true)
    const bad = safeParse(r, { a: 1, c: 2 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "c" }])
    }
  })

  it("a templateLiteral key constrains the key shape", () => {
    const r = record(templateLiteral(["item_", string()]), number())
    expect(safeParse(r, { item_x: 1, item_y: 2 }).success).toBe(true)
    expect(safeParse(r, { foo: 1 }).success).toBe(false)
    expect(r.key).toBeDefined()
  })

  it("still validates values under a key schema", () => {
    const r = record(picklist(["a"]), number())
    expect(safeParse(r, { a: "not a number" }).success).toBe(false)
  })

  it("accepts a partial subset of a finite key set (a record may omit keys)", () => {
    const r = record(picklist(["a", "b"]), number())
    expect(safeParse(r, { a: 1 }).success).toBe(true)
    expect(safeParse(r, {}).success).toBe(true)
  })

  it("a regex-piped string key enforces the pattern at RUNTIME (the TS key type stays `string`)", () => {
    // A `regex`-piped string outputs `string`, so TypeScript cannot express the pattern: the
    // inferred key type is `string` and the emitted type is an unconstrained index signature.
    // The constraint lives at runtime (here) and in JSON Schema (`propertyNames.pattern`).
    const r = record(pipe(string(), regex(/^k_/)), number())
    expect(safeParse(r, { k_a: 1, k_b: 2 }).success).toBe(true)
    const bad = safeParse(r, { nope: 1 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "nope" }])
    }
  })

  it("writes a `__proto__` key as an own property, never onto the prototype", () => {
    const r = record(number())
    // An own `__proto__` key can only be built via JSON.parse, not an object literal.
    const input = JSON.parse('{"__proto__": 1, "a": 2}')
    const res = safeParse(r, input)
    expect(res.success).toBe(true)
    if (res.success) {
      const desc = Object.getOwnPropertyDescriptor(res.output, "__proto__")
      expect(desc?.value).toBe(1)
      // The output's prototype is intact (the key did not corrupt the [[Prototype]] slot).
      expect(Object.getPrototypeOf(res.output)).toBe(Object.prototype)
    }
  })
})
