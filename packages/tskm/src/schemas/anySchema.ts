import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface AnySchema extends BaseSchema<any, any> {
  readonly type: "any"
  readonly reference: typeof any
}

// @__NO_SIDE_EFFECTS__
export function any(): AnySchema {
  return {
    kind: "schema",
    type: "any",
    reference: any,
    expects: "any",
    async: false,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset) {
      const out = dataset as MutableDataset
      out.typed = true
      return out as unknown as OutputDataset<any>
    },
  }
}
