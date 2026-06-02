import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

export interface MultipleOfAction<TInput extends number> extends BaseValidation<TInput> {
  readonly type: "multiple_of"
  readonly reference: typeof multipleOf
  readonly requirement: number
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function multipleOf<TInput extends number>(
  requirement: number,
  message?: string,
): MultipleOfAction<TInput> {
  return {
    kind: "validation",
    type: "multiple_of",
    reference: multipleOf,
    expects: `%${requirement}`,
    async: false,
    requirement,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && dataset.value % requirement !== 0) {
        _addIssue(
          dataset,
          { kind: "validation", type: "multiple_of", expected: `%${requirement}`, message },
          config,
        )
      }
      return dataset
    },
  }
}
