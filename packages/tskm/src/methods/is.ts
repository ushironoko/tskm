import type { InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { safeParse } from "./safeParse.ts"

/**
 * Type guard: narrows `value` to the schema's output type when it validates.
 * Built on `safeParse`, so it never throws. Sync-only — async schemas are a
 * compile-time error.
 *
 * The predicate narrows the original value to `InferOutput`. That is unsound
 * for a schema that transforms the value (`preprocess`, `coerce`, `transform`):
 * `is(coerce.number(), "8080")` types the string as `number` while the runtime
 * value is still `"8080"`. For schemas that contain a transformation, use the
 * output of `parse` / `safeParse`, not the original value.
 */
export function is<const TSchema extends BaseSchema<unknown, unknown>>(
  schema: TSchema,
  value: unknown,
): value is InferOutput<TSchema> {
  return safeParse(schema, value).success
}
