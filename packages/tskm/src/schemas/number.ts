import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface NumberSchema extends BaseSchema<number, number> {
  readonly type: "number"
  readonly reference: typeof number
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function number(message?: string): NumberSchema {
  return {
    kind: "schema",
    type: "number",
    reference: number,
    expects: "number",
    async: false,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (typeof out.value === "number" && !Number.isNaN(out.value)) {
        out.typed = true
      } else {
        _addIssue(dataset, { kind: "schema", type: "number", expected: "number", message }, config)
      }
      return out as unknown as OutputDataset<number>
    },
  }
}
