import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

type Lengthy = { readonly length: number }

export interface MinLengthAction<TInput extends Lengthy> extends BaseValidation<TInput> {
  readonly type: "min_length"
  readonly reference: typeof minLength
  readonly requirement: number
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function minLength<TInput extends Lengthy>(
  requirement: number,
  message?: string,
): MinLengthAction<TInput> {
  return {
    kind: "validation",
    type: "min_length",
    reference: minLength,
    expects: `>=${requirement}`,
    async: false,
    requirement,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && dataset.value.length < requirement) {
        _addIssue(
          dataset,
          { kind: "validation", type: "min_length", expected: `>=${requirement}`, message },
          config,
        )
      }
      return dataset
    },
  }
}
