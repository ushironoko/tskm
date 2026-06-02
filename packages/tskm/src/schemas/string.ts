import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface StringSchema extends BaseSchema<string, string> {
  readonly type: "string"
  readonly reference: typeof string
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function string(message?: string): StringSchema {
  return {
    kind: "schema",
    type: "string",
    reference: string,
    expects: "string",
    async: false,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (typeof out.value === "string") {
        out.typed = true
      } else {
        _addIssue(dataset, { kind: "schema", type: "string", expected: "string", message }, config)
      }
      return out as unknown as OutputDataset<string>
    },
  }
}
