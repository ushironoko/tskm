import { describe, test } from "bun:test"
import { expectTypeOf } from "expect-type"
import {
  array,
  arrayAsync,
  fallback,
  type InferInput,
  type InferOutput,
  number,
  object,
  pipe,
  recursive,
  string,
  transform,
  union,
  unionAsync,
} from "../src/index.ts"

/**
 * Type-level checks for issue #20: `~standard.types` is now a PRESENT carrier, so the
 * vendor-neutral `(typeof schema)["~standard"]["types"]["output"]` query resolves
 * directly, without the `NonNullable` the spec's optional form forced. These assert the
 * raw read across sync, async, recovery, and transform-divergence paths, plus that the
 * compiler's `NonNullable` form resolves to the identical type for a representative
 * schema. The end-to-end "emitted types are unchanged" guarantee (AC2 across every kind)
 * is covered by the compiler integration suite, which materializes tskm schema outputs
 * through `standardOutputExpr` against golden fixtures.
 */

describe("standard.types present marker (#20)", () => {
  test("primitive: ~standard.types carries input/output, readable without NonNullable", () => {
    const s = string()
    expectTypeOf<(typeof s)["~standard"]["types"]["output"]>().toEqualTypeOf<string>()
    expectTypeOf<(typeof s)["~standard"]["types"]["input"]>().toEqualTypeOf<string>()
  })

  test("object: raw read resolves the nested shape", () => {
    const s = object({ a: string(), b: number() })
    expectTypeOf<(typeof s)["~standard"]["types"]["output"]>().toEqualTypeOf<{
      a: string
      b: number
    }>()
  })

  test("union: raw read resolves the member union", () => {
    const s = union([string(), number()])
    expectTypeOf<(typeof s)["~standard"]["types"]["output"]>().toEqualTypeOf<string | number>()
  })

  test("recursive: explicit output param resolves through the raw read", () => {
    type Category = { name: string; children: Category[] }
    const s = recursive<Category>((self) => object({ name: string(), children: array(self) }))
    expectTypeOf<(typeof s)["~standard"]["types"]["output"]>().toEqualTypeOf<Category>()
  })

  test("async: arrayAsync / unionAsync expose the present carrier too", () => {
    const a = arrayAsync(string())
    expectTypeOf<(typeof a)["~standard"]["types"]["output"]>().toEqualTypeOf<string[]>()
    const u = unionAsync([string(), number()])
    expectTypeOf<(typeof u)["~standard"]["types"]["output"]>().toEqualTypeOf<string | number>()
  })

  test("fallback: the recovery wrapper still carries the output type", () => {
    const s = fallback(string(), "default")
    expectTypeOf<(typeof s)["~standard"]["types"]["output"]>().toEqualTypeOf<string>()
  })

  test("transform divergence: input and output read independently from the carrier", () => {
    const s = pipe(
      string(),
      transform((value: string) => value.length),
    )
    expectTypeOf<(typeof s)["~standard"]["types"]["input"]>().toEqualTypeOf<string>()
    expectTypeOf<(typeof s)["~standard"]["types"]["output"]>().toEqualTypeOf<number>()
  })

  test("the compiler's NonNullable form resolves identically (NonNullable is now a no-op)", () => {
    const s = object({ a: string() })
    // `standardOutputExpr` in the compiler emits the NonNullable form. With a present
    // carrier it resolves to the same type as the raw read, so existing emitted queries
    // are unchanged in meaning.
    type Raw = (typeof s)["~standard"]["types"]["output"]
    type ViaNonNullable = NonNullable<(typeof s)["~standard"]["types"]>["output"]
    expectTypeOf<ViaNonNullable>().toEqualTypeOf<Raw>()
  })

  test("InferOutput/InferInput resolve through the same present carrier", () => {
    const s = object({ a: string(), b: number() })
    expectTypeOf<InferOutput<typeof s>>().toEqualTypeOf<{ a: string; b: number }>()
    expectTypeOf<InferInput<typeof s>>().toEqualTypeOf<{ a: string; b: number }>()
  })
})
