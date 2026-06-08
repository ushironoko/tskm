import type { Config } from "../types/config.ts"
import type { OutputDataset, SuccessDataset } from "../types/dataset.ts"
import type { Issue } from "../types/issue.ts"
import { _received } from "../utils/_received.ts"
import { isErrorIssue } from "../utils/_severity.ts"
import type { TransformContext } from "./transform.ts"

/**
 * An async transformation action: maps `TInput` to `TOutput` via a function that
 * returns a Promise. The async twin of a sync `transform` action, including the same
 * `ctx.issue` diagnostic channel.
 */
export interface TransformActionAsync<TInput, TOutput> {
  readonly kind: "transformation"
  readonly type: "transform"
  readonly reference: typeof transformAsync
  readonly async: true
  readonly operation: (input: TInput, ctx: TransformContext) => Promise<TOutput>
  readonly "~run": (
    dataset: SuccessDataset<TInput>,
    config: Config,
  ) => Promise<OutputDataset<TOutput>>
}

/**
 * Builds an async transformation that replaces the dataset value with the awaited
 * result of `operation`, carrying forward any prior issues and any diagnostics the
 * operation records through `ctx.issue`.
 */
// @__NO_SIDE_EFFECTS__
export function transformAsync<TInput, TOutput>(
  operation: (input: TInput, ctx: TransformContext) => Promise<TOutput>,
): TransformActionAsync<TInput, TOutput> {
  return {
    kind: "transformation",
    type: "transform",
    reference: transformAsync,
    async: true,
    operation,
    async "~run"(dataset, _config) {
      const mutable = dataset as { value: unknown; typed?: boolean; issues?: Issue[] }
      const collected: Issue[] = []
      const ctx: TransformContext = {
        issue(message, severity = "error") {
          collected.push({
            kind: "transformation",
            type: "transform",
            expected: null,
            received: _received(mutable.value),
            message,
            input: mutable.value,
            severity,
          })
        },
      }
      mutable.value = await operation(dataset.value, ctx)
      if (collected.length > 0) {
        mutable.issues = mutable.issues ? [...mutable.issues, ...collected] : collected
        if (collected.some(isErrorIssue)) {
          mutable.typed = false
        }
      }
      return dataset as unknown as OutputDataset<TOutput>
    },
  }
}
