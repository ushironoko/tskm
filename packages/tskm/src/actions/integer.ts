import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

export interface IntegerAction<TInput extends number> extends BaseValidation<TInput> {
  readonly type: "integer"
  readonly reference: typeof integer
  readonly requirement: (input: number) => boolean
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function integer<TInput extends number>(message?: string): IntegerAction<TInput> {
  return {
    kind: "validation",
    type: "integer",
    reference: integer,
    expects: null,
    async: false,
    requirement: Number.isInteger,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && !Number.isInteger(dataset.value)) {
        _addIssue(dataset, { kind: "validation", type: "integer", expected: null, message }, config)
      }
      return dataset
    },
  }
}
