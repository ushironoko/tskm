import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface NeverSchema extends BaseSchema<never, never> {
  readonly type: "never"
  readonly reference: typeof never_
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function never_(message?: string): NeverSchema {
  return {
    kind: "schema",
    type: "never",
    reference: never_,
    expects: "never",
    async: false,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      _addIssue(dataset, { kind: "schema", type: "never", expected: "never", message }, config)
      return out as unknown as OutputDataset<never>
    },
  }
}
