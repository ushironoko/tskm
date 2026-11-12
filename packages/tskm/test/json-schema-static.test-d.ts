import { describe, test } from "bun:test"
import type { StandardJSONSchemaV1 as SpecJSON } from "@standard-schema/spec"
import { expectTypeOf } from "expect-type"
import { type InferInput, type InferOutput, number, object, string } from "../src/index.ts"
import type { StaticJsonSchemaDocs } from "../src/json-schema.ts"
import { withStaticJsonSchema } from "../src/json-schema.ts"

describe("withStaticJsonSchema types", () => {
  test("keeps the inferred types and adds Standard JSON Schema", () => {
    const original = object({ name: string(), age: number() })
    const docs = {} satisfies StaticJsonSchemaDocs
    const wrapped = withStaticJsonSchema(original, docs)

    expectTypeOf(wrapped).toExtend<
      SpecJSON<{ name: string; age: number }, { name: string; age: number }>
    >()
    expectTypeOf<InferInput<typeof wrapped>>().toEqualTypeOf<InferInput<typeof original>>()
    expectTypeOf<InferOutput<typeof wrapped>>().toEqualTypeOf<InferOutput<typeof original>>()
    expectTypeOf(wrapped["~standard"].validate).toEqualTypeOf(original["~standard"].validate)
    expectTypeOf(wrapped["~standard"].jsonSchema.input).toEqualTypeOf<SpecJSON.Converter["input"]>()
    expectTypeOf(wrapped["~standard"].jsonSchema.output).toEqualTypeOf<
      SpecJSON.Converter["output"]
    >()
  })
})
