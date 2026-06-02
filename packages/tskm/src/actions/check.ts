import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

export interface CheckAction<TInput> extends BaseValidation<TInput> {
  readonly type: "check"
  readonly reference: typeof check
  readonly requirement: (input: TInput) => boolean
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function check<TInput>(
  requirement: (input: TInput) => boolean,
  message?: string,
): CheckAction<TInput> {
  return {
    kind: "validation",
    type: "check",
    reference: check,
    expects: null,
    async: false,
    requirement,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && !requirement(dataset.value)) {
        _addIssue(dataset, { kind: "validation", type: "check", expected: null, message }, config)
      }
      return dataset
    },
  }
}
