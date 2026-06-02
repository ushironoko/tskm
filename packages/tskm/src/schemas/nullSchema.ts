import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface NullSchema extends BaseSchema<null, null> {
  readonly type: "null"
  readonly reference: typeof null_
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function null_(message?: string): NullSchema {
  return {
    kind: "schema",
    type: "null",
    reference: null_,
    expects: "null",
    async: false,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (out.value === null) {
        out.typed = true
      } else {
        _addIssue(dataset, { kind: "schema", type: "null", expected: "null", message }, config)
      }
      return out as unknown as OutputDataset<null>
    },
  }
}
