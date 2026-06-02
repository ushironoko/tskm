import type { BaseValidation } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"

export interface UrlAction<TInput extends string> extends BaseValidation<TInput> {
  readonly type: "url"
  readonly reference: typeof url
  readonly requirement: (input: string) => boolean
  readonly message: string | undefined
}

// `URL` is a platform global (Node >=20 / browsers). The package targets
// `lib: esnext` without DOM, so reference it through a locally-typed global
// rather than depending on a DOM/Node lib being configured.
const URLCtor = (globalThis as unknown as { URL: new (input: string) => unknown }).URL

function isUrl(input: string): boolean {
  try {
    new URLCtor(input)
    return true
  } catch {
    return false
  }
}

// @__NO_SIDE_EFFECTS__
export function url<TInput extends string>(message?: string): UrlAction<TInput> {
  return {
    kind: "validation",
    type: "url",
    reference: url,
    expects: null,
    async: false,
    requirement: isUrl,
    message,
    "~run"(dataset, config) {
      if (dataset.typed && !isUrl(dataset.value)) {
        _addIssue(dataset, { kind: "validation", type: "url", expected: null, message }, config)
      }
      return dataset
    },
  }
}
