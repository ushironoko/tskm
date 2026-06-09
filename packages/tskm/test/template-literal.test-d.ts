import { describe, test } from "bun:test"
import { expectTypeOf } from "expect-type"
import {
  discriminatedUnion,
  type InferOutput,
  literal,
  number,
  object,
  picklist,
  string,
  templateLiteral,
} from "../src/index.ts"

/**
 * Type-level half of `templateLiteral` (issue #18): the parts fold into a real TS
 * template literal type, so a constrained string compiles to a constrained type instead
 * of widening to `string`.
 */
describe("templateLiteral InferOutput (#18)", () => {
  test("fixed prefix plus a string placeholder", () => {
    const t = templateLiteral(["user_", string()])
    expectTypeOf<InferOutput<typeof t>>().toEqualTypeOf<`user_${string}`>()
  })

  test("number placeholder", () => {
    const t = templateLiteral(["v", number()])
    expectTypeOf<InferOutput<typeof t>>().toEqualTypeOf<`v${number}`>()
  })

  test("a picklist placeholder distributes the union over the template", () => {
    const t = templateLiteral([picklist(["a", "b"]), "-", number()])
    expectTypeOf<InferOutput<typeof t>>().toEqualTypeOf<`a-${number}` | `b-${number}`>()
  })

  test("an all-fixed template is a plain string literal", () => {
    const t = templateLiteral(["a", "b", "c"])
    expectTypeOf<InferOutput<typeof t>>().toEqualTypeOf<"abc">()
  })

  test("a templateLiteral field survives discriminated-union narrowing (#18 fixture)", () => {
    // The motivating scenario: a templated field inside a DU member must keep its template
    // literal type after the tag narrows the union (not widen to `string`).
    const schema = discriminatedUnion("kind", [
      object({ kind: literal("user"), id: templateLiteral(["user_", string()]) }),
      object({ kind: literal("post"), slug: templateLiteral(["post_", number()]) }),
    ])
    type Entity = InferOutput<typeof schema>
    type UserId = Extract<Entity, { kind: "user" }>["id"]
    type PostSlug = Extract<Entity, { kind: "post" }>["slug"]
    expectTypeOf<UserId>().toEqualTypeOf<`user_${string}`>()
    expectTypeOf<PostSlug>().toEqualTypeOf<`post_${number}`>()
  })
})
