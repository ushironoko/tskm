import type { Config } from "../types/config.ts"
import { defaultConfig } from "../types/config.ts"
import type { InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { hasErrorIssue, isErrorIssue } from "../utils/_severity.ts"
import { tskmError } from "../utils/errors.ts"

/**
 * Parses `input` against a (synchronous) schema, returning the typed output or
 * throwing a {@link tskmError}. Accepts only sync schemas — an async schema is a
 * compile-time error (use `parseAsync`). Throws only on `"error"`-severity issues;
 * `"warning"`s do not throw (and are not surfaced by `parse` — use `safeParse`).
 */
export function parse<const TSchema extends BaseSchema<unknown, unknown>>(
  schema: TSchema,
  input: unknown,
  config: Config = defaultConfig,
): InferOutput<TSchema> {
  const dataset = schema["~run"]({ value: input }, config)
  if (hasErrorIssue(dataset.issues)) {
    throw tskmError((dataset.issues ?? []).filter(isErrorIssue))
  }
  return dataset.value as InferOutput<TSchema>
}
