import type { Config } from "../types/config.ts"
import { defaultConfig } from "../types/config.ts"
import type { InferOutput } from "../types/infer.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"
import { hasErrorIssue, isErrorIssue } from "../utils/_severity.ts"
import { tskmError } from "../utils/errors.ts"

/**
 * Async counterpart of `parse`. Accepts both sync and async schemas, awaits the
 * (possibly-promised) dataset, and returns the typed output or throws a
 * {@link tskmError}. Throws only on `"error"`-severity issues.
 */
export async function parseAsync<
  const TSchema extends BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>,
>(schema: TSchema, input: unknown, config: Config = defaultConfig): Promise<InferOutput<TSchema>> {
  const dataset = await schema["~run"]({ value: input }, config)
  if (hasErrorIssue(dataset.issues)) {
    throw tskmError((dataset.issues ?? []).filter(isErrorIssue))
  }
  return dataset.value as InferOutput<TSchema>
}
