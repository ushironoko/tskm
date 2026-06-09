import { describe, test } from "bun:test"
import { expectTypeOf } from "expect-type"
import {
  discriminatedUnion,
  type InferOutput,
  literal,
  number,
  object,
  string,
} from "../src/index.ts"

/**
 * Type-level half of `discriminatedUnion` (issue #15): `InferOutput` is the union of the
 * members, each carrying its literal discriminant, so a consumer can narrow by tag.
 */
describe("discriminatedUnion InferOutput (#15)", () => {
  test("InferOutput is the tagged union of members", () => {
    const shape = discriminatedUnion("kind", [
      object({ kind: literal("circle"), radius: number() }),
      object({ kind: literal("square"), side: string() }),
    ])
    expectTypeOf<InferOutput<typeof shape>>().toEqualTypeOf<
      { kind: "circle"; radius: number } | { kind: "square"; side: string }
    >()
  })

  test("the discriminant key is a literal-typed accessor", () => {
    const shape = discriminatedUnion("t", [object({ t: literal("a"), x: number() })])
    expectTypeOf<(typeof shape)["discriminant"]>().toEqualTypeOf<"t">()
  })
})
