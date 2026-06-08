import { describe, test } from "bun:test"
import { expectTypeOf } from "expect-type"
import {
  type InferOutput,
  nullish,
  number,
  object,
  objectAsync,
  optional,
  string,
} from "../src/index.ts"

/**
 * Type-level half of the faithful optional-property mode (issue #17): `InferObjectOutput`
 * gives `optional`/`nullish` entries a `?` modifier (with `undefined` stripped) only when
 * the object is built with `{ optionalKeys: true }`. The default stays byte-identical.
 */
describe("optionalKeys InferOutput (#17)", () => {
  test("default mode: an optional entry is a required key with a `| undefined` value", () => {
    const s = object({ a: string(), b: optional(string()) })
    expectTypeOf<InferOutput<typeof s>>().toEqualTypeOf<{ a: string; b: string | undefined }>()
  })

  test("optionalKeys: an optional entry becomes an omittable `b?:` key", () => {
    const s = object({ a: string(), b: optional(string()) }, { optionalKeys: true })
    expectTypeOf<InferOutput<typeof s>>().toEqualTypeOf<{ a: string; b?: string }>()
  })

  test("optionalKeys: nullish becomes omittable with `null` kept in the value", () => {
    const s = object({ a: string(), b: nullish(number()) }, { optionalKeys: true })
    expectTypeOf<InferOutput<typeof s>>().toEqualTypeOf<{ a: string; b?: number | null }>()
  })

  test("optionalKeys with no optional entries is the same shape as default", () => {
    const s = object({ a: string(), b: number() }, { optionalKeys: true })
    expectTypeOf<InferOutput<typeof s>>().toEqualTypeOf<{ a: string; b: number }>()
  })

  test("a widened `boolean` optionalKeys falls back to the legacy required shape", () => {
    // Only a LITERAL `true` enables the omittable type; a widened boolean stays legacy, so
    // the type never claims a key is omittable when the runtime value might be `false`.
    const flag: boolean = false
    const s = object({ a: string(), b: optional(string()) }, { optionalKeys: flag })
    expectTypeOf<InferOutput<typeof s>>().toEqualTypeOf<{ a: string; b: string | undefined }>()
  })

  test("objectAsync has optionalKeys type parity", () => {
    const sync = object({ a: string(), b: optional(string()) }, { optionalKeys: true })
    const async = objectAsync({ a: string(), b: optional(string()) }, { optionalKeys: true })
    expectTypeOf<InferOutput<typeof async>>().toEqualTypeOf<InferOutput<typeof sync>>()
    expectTypeOf<InferOutput<typeof async>>().toEqualTypeOf<{ a: string; b?: string }>()
  })
})
