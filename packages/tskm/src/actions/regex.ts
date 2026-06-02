import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

export interface RegexAction<TInput extends string> extends BaseValidation<TInput> {
  readonly type: "regex"
  readonly reference: typeof regex
  readonly requirement: RegExp
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function regex<TInput extends string>(
  requirement: RegExp,
  message?: string,
): RegexAction<TInput> {
  return {
    kind: "validation",
    type: "regex",
    reference: regex,
    expects: `${requirement}`,
    async: false,
    requirement,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && !requirement.test(dataset.value)) {
        _addIssue(
          dataset,
          { kind: "validation", type: "regex", expected: `${requirement}`, message },
          config,
        )
      }
      return dataset
    },
  }
}
