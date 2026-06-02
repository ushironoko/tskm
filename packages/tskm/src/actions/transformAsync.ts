import type { Config } from "../types/config.ts"
import type { OutputDataset, SuccessDataset } from "../types/dataset.ts"

/**
 * An async transformation action: maps `TInput` to `TOutput` via a function that
 * returns a Promise. The async twin of a sync `transform` action.
 */
export interface TransformActionAsync<TInput, TOutput> {
  readonly kind: "transformation"
  readonly type: "transform"
  readonly reference: typeof transformAsync
  readonly async: true
  readonly operation: (input: TInput) => Promise<TOutput>
  readonly "~run": (
    dataset: SuccessDataset<TInput>,
    config: Config,
  ) => Promise<OutputDataset<TOutput>>
}

/**
 * Builds an async transformation that replaces the dataset value with the
 * awaited result of `operation`. Only ever invoked on a well-typed dataset (the
 * async pipe guards this), so it never produces issues.
 */
// @__NO_SIDE_EFFECTS__
export function transformAsync<TInput, TOutput>(
  operation: (input: TInput) => Promise<TOutput>,
): TransformActionAsync<TInput, TOutput> {
  return {
    kind: "transformation",
    type: "transform",
    reference: transformAsync,
    async: true,
    operation,
    async "~run"(dataset, _config) {
      const value = await operation(dataset.value)
      return {
        typed: true,
        value,
      } as SuccessDataset<TOutput>
    },
  }
}
