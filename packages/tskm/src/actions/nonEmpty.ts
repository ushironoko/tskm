import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

type Lengthy = { readonly length: number }

export interface NonEmptyAction<TInput extends Lengthy> extends BaseValidation<TInput> {
  readonly type: "non_empty"
  readonly reference: typeof nonEmpty
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function nonEmpty<TInput extends Lengthy>(message?: string): NonEmptyAction<TInput> {
  return {
    kind: "validation",
    type: "non_empty",
    reference: nonEmpty,
    expects: "!0",
    async: false,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && dataset.value.length === 0) {
        _addIssue(
          dataset,
          { kind: "validation", type: "non_empty", expected: "!0", message },
          config,
        )
      }
      return dataset
    },
  }
}
