// biome-ignore-all lint/suspicious/noTemplateCurlyInString: assertions compare against template-literal key types that contain literal "${...}"
import { describe, test } from "bun:test"
import { expectTypeOf } from "expect-type"
import {
  type InferOutput,
  number,
  picklist,
  record,
  string,
  templateLiteral,
} from "../src/index.ts"

/**
 * Type-level half of the keyed `record` (issue #19): the inferred key type comes from the
 * key schema instead of the constant `string`.
 */
describe("keyed record InferOutput (#19)", () => {
  test("record(value) is unchanged: a string-keyed record", () => {
    const r = record(number())
    expectTypeOf<InferOutput<typeof r>>().toEqualTypeOf<Record<string, number>>()
  })

  test("a templateLiteral key produces a templated (partial) index signature", () => {
    const r = record(templateLiteral(["item_", string()]), number())
    expectTypeOf<InferOutput<typeof r>>().toEqualTypeOf<Partial<Record<`item_${string}`, number>>>()
  })

  test("a picklist key produces a finite, omittable literal key set", () => {
    const r = record(picklist(["a", "b"]), number())
    // Partial: a keyed record is a dictionary, so each key may be absent (matches runtime).
    expectTypeOf<InferOutput<typeof r>>().toEqualTypeOf<Partial<Record<"a" | "b", number>>>()
  })

  test("a number-output key schema is rejected (keys are always strings)", () => {
    // @ts-expect-error number() output is not string-assignable, so it is not a record key
    record(number(), number())
  })
})
