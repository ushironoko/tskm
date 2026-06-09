import type { Config } from "../types/config.ts"
import { defaultConfig } from "../types/config.ts"
import type { InferOutput } from "../types/infer.ts"
import type { Issue } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"
import { hasErrorIssue, isWarningIssue } from "../utils/_severity.ts"

export type SafeParseResult<TSchema extends BaseSchema<unknown, unknown>> =
  | {
      readonly success: true
      readonly output: InferOutput<TSchema>
      readonly issues: undefined
      readonly warnings: readonly Issue[]
    }
  | {
      readonly success: false
      readonly output: unknown
      readonly issues: readonly Issue[]
      readonly warnings: readonly Issue[]
    }

/**
 * Parses `input` without throwing, returning a discriminated result. This is the
 * primary, ergonomic API; `parse` is the throwing convenience wrapper.
 *
 * Success is decided by the absence of any `"error"`-severity issue: a parse that
 * produced only `"warning"`s succeeds, with those carried on `warnings`.
 */
export function safeParse<const TSchema extends BaseSchema<unknown, unknown>>(
  schema: TSchema,
  input: unknown,
  config: Config = defaultConfig,
): SafeParseResult<TSchema> {
  const dataset = schema["~run"]({ value: input }, config)
  // `~run` never produces a defined-but-empty `issues`, so undefined means a clean parse:
  // skip the warnings filter entirely and return a fresh empty array (identical to the old
  // `[].filter(...)` result: a new, non-frozen `readonly Issue[]` on every clean parse).
  if (dataset.issues === undefined) {
    return {
      success: true,
      output: dataset.value as InferOutput<TSchema>,
      issues: undefined,
      warnings: [],
    }
  }
  const issues = dataset.issues
  const warnings = issues.filter(isWarningIssue)
  if (hasErrorIssue(issues)) {
    return { success: false, output: dataset.value, issues, warnings }
  }
  return {
    success: true,
    output: dataset.value as InferOutput<TSchema>,
    issues: undefined,
    warnings,
  }
}
