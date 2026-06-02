import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

type ValueInput = number | bigint | Date | string

export interface MaxValueAction<TInput extends ValueInput, TRequirement extends TInput>
  extends BaseValidation<TInput> {
  readonly type: "max_value"
  readonly reference: typeof maxValue
  readonly requirement: TRequirement
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function maxValue<TInput extends ValueInput, const TRequirement extends TInput>(
  requirement: TRequirement,
  message?: string,
): MaxValueAction<TInput, TRequirement> {
  return {
    kind: "validation",
    type: "max_value",
    reference: maxValue,
    expects: `<=${requirement instanceof Date ? requirement.toJSON() : requirement}`,
    async: false,
    requirement,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && dataset.value > requirement) {
        _addIssue(
          dataset,
          {
            kind: "validation",
            type: "max_value",
            expected: `<=${requirement instanceof Date ? requirement.toJSON() : requirement}`,
            message,
          },
          config,
        )
      }
      return dataset
    },
  }
}
