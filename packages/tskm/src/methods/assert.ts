import type { Config } from "../types/config.ts"
import { defaultConfig } from "../types/config.ts"
import type { InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { hasErrorIssue, isErrorIssue } from "../utils/_severity.ts"
import { tskmError } from "../utils/errors.ts"

/**
 * Asserts `value` matches the schema, narrowing it to the output type for the
 * rest of the scope. Throws a {@link tskmError} on failure. Sync-only — async
 * schemas are a compile-time error (use the async surface instead). A warning-only
 * parse is a success and does not throw.
 */
export function assert<const TSchema extends BaseSchema<unknown, unknown>>(
  schema: TSchema,
  value: unknown,
  config: Config = defaultConfig,
): asserts value is InferOutput<TSchema> {
  const dataset = schema["~run"]({ value }, config)
  if (hasErrorIssue(dataset.issues)) {
    throw tskmError((dataset.issues ?? []).filter(isErrorIssue))
  }
}
