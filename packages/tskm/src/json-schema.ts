import { convertToJsonSchema } from "./json-schema/convert.ts"
import type { InferInput, InferOutput } from "./types/infer.ts"
import type { BaseSchema, BaseSchemaAsync } from "./types/schema.ts"
import type { StandardJSONSchemaV1 } from "./types/standard.ts"

type JsonSchemaOptions = StandardJSONSchemaV1.Options

type AnySchema = BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>

export type { StandardJSONSchemaV1 } from "./types/standard.ts"

/**
 * Returns a new schema that also implements Standard JSON Schema.
 *
 * The argument is not mutated. `~standard.validate` and the inferred input and
 * output types are the original schema's. Conversion walks that same object, so
 * cycle identity matches the schema the caller built.
 *
 * Unrepresentable schemas do not throw here. `jsonSchema.input` / `output`
 * throw when called, which is what the spec allows.
 */
export function withJsonSchema<TSchema extends AnySchema>(
  schema: TSchema,
): TSchema & StandardJSONSchemaV1<InferInput<TSchema>, InferOutput<TSchema>> {
  return {
    ...schema,
    get "~standard"() {
      const base = schema["~standard"]
      return {
        version: base.version,
        vendor: base.vendor,
        validate: base.validate,
        jsonSchema: {
          input(options: JsonSchemaOptions) {
            return convertToJsonSchema(schema, "input", options)
          },
          output(options: JsonSchemaOptions) {
            return convertToJsonSchema(schema, "output", options)
          },
        },
      }
    },
  } as TSchema & StandardJSONSchemaV1<InferInput<TSchema>, InferOutput<TSchema>>
}
