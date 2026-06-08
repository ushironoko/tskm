import type { Config } from "../types/config.ts"
import { defaultConfig } from "../types/config.ts"
import type { InferOutput } from "../types/infer.ts"
import type { Issue } from "../types/issue.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"
import { hasErrorIssue, isWarningIssue } from "../utils/_severity.ts"

export type SafeParseAsyncResult<
  TSchema extends BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>,
> =
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
 * Async counterpart of `safeParse`. Accepts both sync and async schemas, awaits
 * the (possibly-promised) dataset, and returns a discriminated result without
 * throwing. Success is decided by the absence of any `"error"`-severity issue.
 */
export async function safeParseAsync<
  const TSchema extends BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>,
>(
  schema: TSchema,
  input: unknown,
  config: Config = defaultConfig,
): Promise<SafeParseAsyncResult<TSchema>> {
  const dataset = await schema["~run"]({ value: input }, config)
  const issues = dataset.issues ?? []
  const warnings = issues.filter(isWarningIssue)
  if (hasErrorIssue(dataset.issues)) {
    return { success: false, output: dataset.value, issues, warnings }
  }
  return {
    success: true,
    output: dataset.value as InferOutput<TSchema>,
    issues: undefined,
    warnings,
  }
}
