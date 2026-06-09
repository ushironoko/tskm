import type { Config } from "../types/config.ts"
import type { OutputDataset, SuccessDataset, UnknownDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

export interface FallbackSchema<
  TSchema extends BaseSchema<unknown, unknown>,
  TFallback extends InferOutput<TSchema>,
> extends BaseSchema<InferInput<TSchema>, InferOutput<TSchema>> {
  readonly type: "fallback"
  readonly reference: typeof fallback
  readonly wrapped: TSchema
  readonly fallback: TFallback
}

/**
 * Wraps a schema so that on ANY validation failure it returns `fallbackValue`
 * as a typed success. Unlike a `default` (which only fills in `undefined`
 * input), this recovers from every issue — wrong shape and failed refinements
 * alike. Returns a new schema; the original is untouched.
 */
// @__NO_SIDE_EFFECTS__
export function fallback<
  const TSchema extends BaseSchema<unknown, unknown>,
  const TFallback extends InferOutput<TSchema>,
>(schema: TSchema, fallbackValue: TFallback): FallbackSchema<TSchema, TFallback> {
  return {
    kind: "schema",
    type: "fallback",
    reference: fallback,
    expects: schema.expects,
    async: false,
    wrapped: schema,
    fallback: fallbackValue,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset: UnknownDataset, config: Config) {
      const result = schema["~run"](dataset, config) as OutputDataset<unknown>
      if (hasErrorIssue(result.issues)) {
        // Recover ONLY on an error: a warning-only result is already a success and keeps
        // its real value rather than being replaced by the fallback.
        return {
          typed: true,
          value: fallbackValue,
        } as SuccessDataset<InferOutput<TSchema>>
      }
      return result as OutputDataset<InferOutput<TSchema>>
    },
  }
}
