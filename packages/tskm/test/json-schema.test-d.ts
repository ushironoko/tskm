import { describe, test } from "bun:test"
import type { StandardJSONSchemaV1 as SpecJSON } from "@standard-schema/spec"
import { expectTypeOf } from "expect-type"
import {
  number,
  object,
  optional,
  pipe,
  type StandardJSONSchemaV1,
  type StandardProps,
  string,
  transform,
} from "../src/index.ts"

describe("StandardJSONSchemaV1 matches @standard-schema/spec@1.1.0", () => {
  test("the vendored interface is the spec interface", () => {
    expectTypeOf<StandardJSONSchemaV1<string, number>>().toEqualTypeOf<SpecJSON<string, number>>()
    expectTypeOf<StandardJSONSchemaV1.Props<string, number>>().toEqualTypeOf<
      SpecJSON.Props<string, number>
    >()
    expectTypeOf<StandardJSONSchemaV1.Options>().toEqualTypeOf<SpecJSON.Options>()
    expectTypeOf<StandardJSONSchemaV1.Target>().toEqualTypeOf<SpecJSON.Target>()
    expectTypeOf<StandardJSONSchemaV1.Converter>().toEqualTypeOf<SpecJSON.Converter>()
  })

  test("a schema satisfies Standard JSON Schema and keeps input/output apart", () => {
    const user = object({ name: string(), age: optional(number(), 0) })
    expectTypeOf(user).toExtend<
      SpecJSON<{ name: string; age: number | undefined }, { name: string; age: number | undefined }>
    >()
    expectTypeOf<StandardProps<string, number>>().toExtend<SpecJSON.Props<string, number>>()

    const changed = pipe(
      string(),
      transform((value: string) => value.length),
    )
    expectTypeOf(changed).toExtend<SpecJSON<string, number>>()
    expectTypeOf(changed["~standard"].jsonSchema.input).toEqualTypeOf<SpecJSON.Converter["input"]>()
    expectTypeOf(changed["~standard"].jsonSchema.output).toEqualTypeOf<
      SpecJSON.Converter["output"]
    >()
  })
})
