import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface BigintSchema extends BaseSchema<bigint, bigint> {
  readonly type: "bigint"
  readonly reference: typeof bigint
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function bigint(message?: string): BigintSchema {
  return {
    kind: "schema",
    type: "bigint",
    reference: bigint,
    expects: "bigint",
    async: false,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (typeof out.value === "bigint") {
        out.typed = true
      } else {
        _addIssue(dataset, { kind: "schema", type: "bigint", expected: "bigint", message }, config)
      }
      return out as unknown as OutputDataset<bigint>
    },
  }
}
