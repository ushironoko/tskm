import type { Config } from "../types/config.ts"
import { defaultConfig } from "../types/config.ts"
import type { InferOutput } from "../types/infer.ts"
import type { Issue } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"

export type SafeParseResult<TSchema extends BaseSchema<unknown, unknown>> =
  | { readonly success: true; readonly output: InferOutput<TSchema>; readonly issues: undefined }
  | { readonly success: false; readonly output: unknown; readonly issues: readonly Issue[] }

/**
 * Parses `input` without throwing, returning a discriminated result. This is the
 * primary, ergonomic API; `parse` is the throwing convenience wrapper.
 */
export function safeParse<const TSchema extends BaseSchema<unknown, unknown>>(
  schema: TSchema,
  input: unknown,
  config: Config = defaultConfig,
): SafeParseResult<TSchema> {
  const dataset = schema["~run"]({ value: input }, config)
  if (dataset.issues) {
    return { success: false, output: dataset.value, issues: dataset.issues }
  }
  return { success: true, output: dataset.value as InferOutput<TSchema>, issues: undefined }
}
