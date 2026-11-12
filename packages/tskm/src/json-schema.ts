import { convertToJsonSchema } from "./json-schema/convert.ts"
import type { InferInput, InferOutput } from "./types/infer.ts"
import type { BaseSchema, BaseSchemaAsync } from "./types/schema.ts"
import type { StandardJSONSchemaV1 } from "./types/standard.ts"

export { convertToJsonSchema, retargetJsonSchema } from "./json-schema/convert.ts"
export {
  type StaticJsonSchemaDocs,
  type StaticJsonSchemaDocument,
  type StaticJsonSchemaSide,
  withStaticJsonSchema,
} from "./json-schema/static.ts"

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
  // One plain object, not a getter. Each read of `~standard` must be the same
  // reference, and `jsonSchema` must be stable across those reads. Spreading the
  // base props keeps `version`, `vendor`, `validate`, and `types` (when present)
  // identical to the original.
  const base = schema["~standard"]
  const jsonSchema = {
    input(options: JsonSchemaOptions) {
      return convertToJsonSchema(schema, "input", options)
    },
    output(options: JsonSchemaOptions) {
      return convertToJsonSchema(schema, "output", options)
    },
  }
  return {
    ...schema,
    "~standard": { ...base, jsonSchema },
  } as TSchema & StandardJSONSchemaV1<InferInput<TSchema>, InferOutput<TSchema>>
}
