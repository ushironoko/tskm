import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface UnknownSchema extends BaseSchema<unknown, unknown> {
  readonly type: "unknown"
  readonly reference: typeof unknown
}

// @__NO_SIDE_EFFECTS__
export function unknown(): UnknownSchema {
  return {
    kind: "schema",
    type: "unknown",
    reference: unknown,
    expects: "unknown",
    async: false,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset) {
      const out = dataset as MutableDataset
      out.typed = true
      return out as unknown as OutputDataset<unknown>
    },
  }
}
