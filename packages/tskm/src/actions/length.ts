import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

type Lengthy = { readonly length: number }

export interface LengthAction<TInput extends Lengthy> extends BaseValidation<TInput> {
  readonly type: "length"
  readonly reference: typeof length
  readonly requirement: number
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function length<TInput extends Lengthy>(
  requirement: number,
  message?: string,
): LengthAction<TInput> {
  return {
    kind: "validation",
    type: "length",
    reference: length,
    expects: `${requirement}`,
    async: false,
    requirement,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && dataset.value.length !== requirement) {
        _addIssue(
          dataset,
          { kind: "validation", type: "length", expected: `${requirement}`, message },
          config,
        )
      }
      return dataset
    },
  }
}
