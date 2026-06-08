import { describe, expect, it } from "bun:test"
import {
  nullish,
  object,
  objectAsync,
  optional,
  parse,
  parseAsync,
  safeParse,
  string,
  unknown,
} from "../src/index.ts"

/**
 * Faithful optional-property mode (issue #17). `object(entries, { optionalKeys: true })`
 * makes `optional`/`nullish` keys omittable: a missing one is left absent in the output
 * rather than materialized as `undefined`. Off by default (byte-identical legacy output).
 */
describe("faithful optional-property runtime mode (#17)", () => {
  it("default: a missing optional key is materialized as undefined (present)", () => {
    const schema = object({ a: string(), b: optional(string()) })
    const out = parse(schema, { a: "x" })
    expect(out).toEqual({ a: "x", b: undefined })
    expect("b" in out).toBe(true)
  })

  it("optionalKeys: a missing optional key is omitted from the output", () => {
    const schema = object({ a: string(), b: optional(string()) }, { optionalKeys: true })
    const out = parse(schema, { a: "x" })
    expect(out).toEqual({ a: "x" })
    expect("b" in out).toBe(false)
  })

  it("optionalKeys: a present optional value is kept", () => {
    const schema = object({ a: string(), b: optional(string()) }, { optionalKeys: true })
    expect(parse(schema, { a: "x", b: "y" })).toEqual({ a: "x", b: "y" })
  })

  it("optionalKeys: an explicit `{ b: undefined }` input is dropped like a missing key", () => {
    // The drop is on the output value, so an explicitly-supplied `undefined` is omitted,
    // matching the omittable `b?: string` type (whose value excludes `undefined`).
    const schema = object({ a: string(), b: optional(string()) }, { optionalKeys: true })
    const out = parse(schema, { a: "x", b: undefined })
    expect("b" in out).toBe(false)
  })

  it("optionalKeys: nullish keeps null but omits a missing key", () => {
    const schema = object({ a: string(), b: nullish(string()) }, { optionalKeys: true })
    expect(parse(schema, { a: "x", b: null })).toEqual({ a: "x", b: null })
    const out = parse(schema, { a: "x" })
    expect("b" in out).toBe(false)
  })

  it("optionalKeys: an optional with a default still materializes the default", () => {
    const schema = object({ a: string(), b: optional(string(), "d") }, { optionalKeys: true })
    expect(parse(schema, { a: "x" })).toEqual({ a: "x", b: "d" })
  })

  it("required keys and validation are unaffected by the mode", () => {
    const schema = object({ a: string(), b: optional(string()) }, { optionalKeys: true })
    const r = safeParse(schema, { a: 1 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.path).toEqual([{ key: "a" }])
    }
  })

  it("the options form still carries the message override", () => {
    const schema = object({ a: string() }, { message: "nope" })
    const r = safeParse(schema, 1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("nope")
    }
  })

  it("objectAsync has optionalKeys parity: a missing optional key is omitted", async () => {
    const schema = objectAsync({ a: string(), b: optional(string()) }, { optionalKeys: true })
    const out = await parseAsync(schema, { a: "x" })
    expect("b" in out).toBe(false)
    expect(schema.optionalKeys).toBe(true)
  })

  it("objectAsync default keeps a missing optional as undefined", async () => {
    const schema = objectAsync({ a: string(), b: optional(string()) })
    const out = await parseAsync(schema, { a: "x" })
    expect("b" in out).toBe(true)
  })

  it("objectAsync writes a declared __proto__ key safely", async () => {
    const schema = objectAsync({ ["__proto__"]: unknown() })
    const out = await parseAsync(schema, JSON.parse('{"__proto__":1}'))
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })
})
