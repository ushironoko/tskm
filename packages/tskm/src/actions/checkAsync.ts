import type { Config } from "../types/config.ts"
import type { OutputDataset } from "../types/dataset.ts"
import { _addIssue } from "../utils/_addIssue.ts"

/**
 * An async validation action: refines without changing the type, using a
 * requirement that returns a Promise. The async twin of a sync `check` action.
 */
export interface CheckActionAsync<TInput> {
  readonly kind: "validation"
  readonly type: "check"
  readonly reference: typeof checkAsync
  readonly expects: null
  readonly async: true
  readonly requirement: (input: TInput) => Promise<boolean>
  readonly message: string | undefined
  readonly "~run": (
    dataset: OutputDataset<TInput>,
    config: Config,
  ) => Promise<OutputDataset<TInput>>
}

/**
 * Builds an async validation that adds an issue when the awaited `requirement`
 * returns `false`. Skips already-untyped datasets, mirroring sync validations.
 */
// @__NO_SIDE_EFFECTS__
export function checkAsync<TInput>(
  requirement: (input: TInput) => Promise<boolean>,
  message?: string,
): CheckActionAsync<TInput> {
  return {
    kind: "validation",
    type: "check",
    reference: checkAsync,
    expects: null,
    async: true,
    requirement,
    message,
    async "~run"(dataset, config) {
      if (dataset.typed && !(await requirement(dataset.value))) {
        _addIssue(dataset, { kind: "validation", type: "check", expected: null, message }, config)
      }
      return dataset
    },
  }
}
