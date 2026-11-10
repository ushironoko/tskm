import type { InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { safeParse } from "./safeParse.ts"

/**
 * Type guard: narrows `value` to the schema's output type when it validates.
 * Built on `safeParse`, so it never throws. Sync-only — async schemas are a
 * compile-time error.
 *
 * The predicate narrows the original value to `InferOutput`. That is unsound
 * for a schema that transforms the value (`preprocess`, `transform`):
 * `is(preprocess(digits, number()), "8080")` types the string as `number`
 * while the runtime value is still `"8080"`. `digits` returns the value
 * unchanged unless it matches `/^[0-9]+$/`:
 * `(value) => (typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value)`.
 * For schemas that contain a transformation, use the output of `parse` /
 * `safeParse`, not the original value.
 */
export function is<const TSchema extends BaseSchema<unknown, unknown>>(
  schema: TSchema,
  value: unknown,
): value is InferOutput<TSchema> {
  return safeParse(schema, value).success
}
