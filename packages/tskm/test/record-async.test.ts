import { describe, expect, it } from "bun:test"
import {
  number,
  picklist,
  pipeAsync,
  recordAsync,
  safeParseAsync,
  string,
  templateLiteral,
  transformAsync,
} from "../src/index.ts"

/**
 * Async parity for the keyed `record` (issue #19 / contract section 3): `recordAsync` mirrors
 * `record` and awaits async key/value schemas, so a record of async-validated values is usable.
 */
describe("recordAsync runtime (#19 async parity)", () => {
  const asyncUpper = pipeAsync(
    string(),
    transformAsync(async (value: string) => value.toUpperCase()),
  )

  it("recordAsync(value) awaits an async value schema and has no key schema", async () => {
    const r = await safeParseAsync(recordAsync(asyncUpper), { a: "x", b: "y" })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({ a: "X", b: "Y" })
    }
    expect(recordAsync(asyncUpper).key).toBeUndefined()
  })

  it("recordAsync(value, message) keeps the trailing message disambiguation", async () => {
    const r = await safeParseAsync(recordAsync(number(), "nope"), 5)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("nope")
    }
  })

  it("a picklist key rejects an out-of-set key with the key on the path", async () => {
    const r = recordAsync(picklist(["a", "b"]), number())
    expect((await safeParseAsync(r, { a: 1, b: 2 })).success).toBe(true)
    const bad = await safeParseAsync(r, { a: 1, c: 2 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "c" }])
    }
  })

  it("a templateLiteral key constrains the key shape", async () => {
    const r = recordAsync(templateLiteral(["item_", string()]), number())
    expect((await safeParseAsync(r, { item_x: 1 })).success).toBe(true)
    expect((await safeParseAsync(r, { foo: 1 })).success).toBe(false)
    expect(r.key).toBeDefined()
  })

  it("validates async values under a key schema", async () => {
    const r = recordAsync(picklist(["a"]), asyncUpper)
    const ok = await safeParseAsync(r, { a: "hi" })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.output).toEqual({ a: "HI" })
    }
  })

  it("accepts a partial subset of a finite key set", async () => {
    const r = recordAsync(picklist(["a", "b"]), number())
    expect((await safeParseAsync(r, { a: 1 })).success).toBe(true)
    expect((await safeParseAsync(r, {})).success).toBe(true)
  })

  it("writes a `__proto__` key as an own property, never onto the prototype", async () => {
    const input = JSON.parse('{"__proto__": 1, "a": 2}')
    const res = await safeParseAsync(recordAsync(number()), input)
    expect(res.success).toBe(true)
    if (res.success) {
      const desc = Object.getOwnPropertyDescriptor(res.output, "__proto__")
      expect(desc?.value).toBe(1)
      expect(Object.getPrototypeOf(res.output)).toBe(Object.prototype)
    }
  })

  it("rejects a non-object input", async () => {
    expect((await safeParseAsync(recordAsync(number()), 5)).success).toBe(false)
  })
})
