import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface UndefinedSchema extends BaseSchema<undefined, undefined> {
  readonly type: "undefined"
  readonly reference: typeof undefined_
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function undefined_(message?: string): UndefinedSchema {
  return {
    kind: "schema",
    type: "undefined",
    reference: undefined_,
    expects: "undefined",
    async: false,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (out.value === undefined) {
        out.typed = true
      } else {
        _addIssue(
          dataset,
          { kind: "schema", type: "undefined", expected: "undefined", message },
          config,
        )
      }
      return out as unknown as OutputDataset<undefined>
    },
  }
}
