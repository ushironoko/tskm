import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

// Pragmatic email regex (matches valibot's): a single `@`, no whitespace,
// a dotted domain. Not a full RFC 5322 parser by design.
const EMAIL_REGEX = /^[\w+-]+(?:\.[\w+-]+)*@[\da-z]+(?:[.-][\da-z]+)*\.[a-z]{2,}$/i

export interface EmailAction<TInput extends string> extends BaseValidation<TInput> {
  readonly type: "email"
  readonly reference: typeof email
  readonly requirement: RegExp
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function email<TInput extends string>(message?: string): EmailAction<TInput> {
  return {
    kind: "validation",
    type: "email",
    reference: email,
    expects: null,
    async: false,
    requirement: EMAIL_REGEX,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && !EMAIL_REGEX.test(dataset.value)) {
        _addIssue(dataset, { kind: "validation", type: "email", expected: null, message }, config)
      }
      return dataset
    },
  }
}
