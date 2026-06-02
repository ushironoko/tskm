import type { InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { safeParse } from "./safeParse.ts"

/**
 * Type guard: narrows `value` to the schema's output type when it validates.
 * Built on `safeParse`, so it never throws. Sync-only — async schemas are a
 * compile-time error.
 */
export function is<const TSchema extends BaseSchema<unknown, unknown>>(
  schema: TSchema,
  value: unknown,
): value is InferOutput<TSchema> {
  return safeParse(schema, value).success
}
