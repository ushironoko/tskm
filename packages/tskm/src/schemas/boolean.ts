import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface BooleanSchema extends BaseSchema<boolean, boolean> {
  readonly type: "boolean"
  readonly reference: typeof boolean
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function boolean(message?: string): BooleanSchema {
  return {
    kind: "schema",
    type: "boolean",
    reference: boolean,
    expects: "boolean",
    async: false,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (typeof out.value === "boolean") {
        out.typed = true
      } else {
        _addIssue(
          dataset,
          { kind: "schema", type: "boolean", expected: "boolean", message },
          config,
        )
      }
      return out as unknown as OutputDataset<boolean>
    },
  }
}
