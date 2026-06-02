import type { Config } from "../types/config.ts"
import { defaultConfig } from "../types/config.ts"
import type { InferOutput } from "../types/infer.ts"
import type { Issue } from "../types/issue.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"

export type SafeParseAsyncResult<
  TSchema extends BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>,
> =
  | { readonly success: true; readonly output: InferOutput<TSchema>; readonly issues: undefined }
  | { readonly success: false; readonly output: unknown; readonly issues: readonly Issue[] }

/**
 * Async counterpart of `safeParse`. Accepts both sync and async schemas, awaits
 * the (possibly-promised) dataset, and returns a discriminated result without
 * throwing.
 */
export async function safeParseAsync<
  const TSchema extends BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>,
>(
  schema: TSchema,
  input: unknown,
  config: Config = defaultConfig,
): Promise<SafeParseAsyncResult<TSchema>> {
  const dataset = await schema["~run"]({ value: input }, config)
  if (dataset.issues) {
    return { success: false, output: dataset.value, issues: dataset.issues }
  }
  return { success: true, output: dataset.value as InferOutput<TSchema>, issues: undefined }
}
