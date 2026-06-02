import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface DateSchema extends BaseSchema<Date, Date> {
  readonly type: "date"
  readonly reference: typeof date
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function date(message?: string): DateSchema {
  return {
    kind: "schema",
    type: "date",
    reference: date,
    expects: "Date",
    async: false,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (out.value instanceof Date && !Number.isNaN(out.value.getTime())) {
        out.typed = true
      } else {
        _addIssue(dataset, { kind: "schema", type: "date", expected: "Date", message }, config)
      }
      return out as unknown as OutputDataset<Date>
    },
  }
}
