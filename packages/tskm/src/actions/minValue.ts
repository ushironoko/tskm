import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

type ValueInput = number | bigint | Date | string

export interface MinValueAction<TInput extends ValueInput, TRequirement extends TInput>
  extends BaseValidation<TInput> {
  readonly type: "min_value"
  readonly reference: typeof minValue
  readonly requirement: TRequirement
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function minValue<TInput extends ValueInput, const TRequirement extends TInput>(
  requirement: TRequirement,
  message?: string,
): MinValueAction<TInput, TRequirement> {
  return {
    kind: "validation",
    type: "min_value",
    reference: minValue,
    expects: `>=${requirement instanceof Date ? requirement.toJSON() : requirement}`,
    async: false,
    requirement,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && dataset.value < requirement) {
        _addIssue(
          dataset,
          {
            kind: "validation",
            type: "min_value",
            expected: `>=${requirement instanceof Date ? requirement.toJSON() : requirement}`,
            message,
          },
          config,
        )
      }
      return dataset
    },
  }
}
