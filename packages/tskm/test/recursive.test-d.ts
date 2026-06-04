import { describe, test } from "bun:test"
import { expectTypeOf } from "expect-type"
import {
  array,
  type GenericSchema,
  type InferOutput,
  number,
  object,
  optional,
  recursive,
  string,
} from "../src/index.ts"

describe("recursive type-level", () => {
  test("plain-arrow authoring compiles without any annotation (the rival wall)", () => {
    // No hand-written type, no `GenericSchema<T>` const annotation, no TS7022/7006:
    // `self` is contextually typed by the builder parameter, so the initializer never
    // references its own const.
    const node = recursive((self) =>
      object({
        value: number(),
        next: optional(self),
      }),
    )
    // The one-level-unrolled shape is visible at authoring time; the self position is
    // loose — the precise recursive alias is materialized by the AOT compiler.
    expectTypeOf<InferOutput<typeof node>["value"]>().toEqualTypeOf<number>()
  })

  test("generic-arrow authoring (Tier-1 capable) threads S through the body structurally", () => {
    const category = recursive(<S extends GenericSchema<any>>(self: S) =>
      object({
        name: string(),
        children: array(self),
      }),
    )
    expectTypeOf<InferOutput<typeof category>["name"]>().toEqualTypeOf<string>()
    // `build` keeps the caller's generic signature: instantiating it with a concrete
    // schema type unrolls the body one level with that type at the self positions.
    type Probe = { readonly __probe: "p" }
    type Unrolled = InferOutput<ReturnType<typeof category.build<GenericSchema<Probe>>>>
    expectTypeOf<Unrolled["children"]>().toEqualTypeOf<Probe[]>()
  })

  test("explicit output param pins ~types for Standard Schema consumers", () => {
    type Category = { name: string; children: Category[] }
    const categorySchema = recursive<Category>((self) =>
      object({
        name: string(),
        children: array(self),
      }),
    )
    expectTypeOf<InferOutput<typeof categorySchema>>().toEqualTypeOf<Category>()
  })
})
