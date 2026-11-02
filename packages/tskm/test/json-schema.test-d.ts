import { describe, test } from "bun:test"
import type { StandardJSONSchemaV1 as SpecJSON } from "@standard-schema/spec"
import { expectTypeOf } from "expect-type"
import {
  type InferInput,
  type InferOutput,
  number,
  object,
  optional,
  pipe,
  type StandardJSONSchemaV1,
  string,
  transform,
} from "../src/index.ts"
import { withJsonSchema } from "../src/json-schema.ts"

describe("withJsonSchema types", () => {
  test("the vendored interface matches @standard-schema/spec@1.1.0", () => {
    expectTypeOf<StandardJSONSchemaV1<string, number>>().toEqualTypeOf<SpecJSON<string, number>>()
    expectTypeOf<StandardJSONSchemaV1.Props<string, number>>().toEqualTypeOf<
      SpecJSON.Props<string, number>
    >()
    expectTypeOf<StandardJSONSchemaV1.Options>().toEqualTypeOf<SpecJSON.Options>()
    expectTypeOf<StandardJSONSchemaV1.Target>().toEqualTypeOf<SpecJSON.Target>()
    expectTypeOf<StandardJSONSchemaV1.Converter>().toEqualTypeOf<SpecJSON.Converter>()
  })

  test("the wrapper keeps the inferred types and validate, and adds Standard JSON Schema", () => {
    const original = object({ name: string(), age: optional(number(), 0) })
    const wrapped = withJsonSchema(original)

    expectTypeOf(wrapped).toExtend<
      SpecJSON<{ name: string; age: number | undefined }, { name: string; age: number | undefined }>
    >()
    expectTypeOf<InferInput<typeof wrapped>>().toEqualTypeOf<InferInput<typeof original>>()
    expectTypeOf<InferOutput<typeof wrapped>>().toEqualTypeOf<InferOutput<typeof original>>()
    expectTypeOf(wrapped["~standard"].validate).toEqualTypeOf(original["~standard"].validate)
    expectTypeOf(wrapped["~standard"].jsonSchema.input).toEqualTypeOf<SpecJSON.Converter["input"]>()
    expectTypeOf(wrapped["~standard"].jsonSchema.output).toEqualTypeOf<
      SpecJSON.Converter["output"]
    >()

    const changed = withJsonSchema(
      pipe(
        string(),
        transform((value: string) => value.length),
      ),
    )
    expectTypeOf<InferInput<typeof changed>>().toEqualTypeOf<string>()
    expectTypeOf<InferOutput<typeof changed>>().toEqualTypeOf<number>()
    expectTypeOf(changed).toExtend<SpecJSON<string, number>>()
  })
})
