import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

type Lengthy = { readonly length: number }

export interface MaxLengthAction<TInput extends Lengthy> extends BaseValidation<TInput> {
  readonly type: "max_length"
  readonly reference: typeof maxLength
  readonly requirement: number
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function maxLength<TInput extends Lengthy>(
  requirement: number,
  message?: string,
): MaxLengthAction<TInput> {
  return {
    kind: "validation",
    type: "max_length",
    reference: maxLength,
    expects: `<=${requirement}`,
    async: false,
    requirement,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && dataset.value.length > requirement) {
        _addIssue(
          dataset,
          { kind: "validation", type: "max_length", expected: `<=${requirement}`, message },
          config,
        )
      }
      return dataset
    },
  }
}
