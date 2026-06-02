import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export type PicklistOptions = readonly (string | number | boolean)[]

export interface PicklistSchema<T extends PicklistOptions>
  extends BaseSchema<T[number], T[number]> {
  readonly type: "picklist"
  readonly reference: typeof picklist
  readonly options: T
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function picklist<const T extends PicklistOptions>(
  options: T,
  message?: string,
): PicklistSchema<T> {
  return {
    kind: "schema",
    type: "picklist",
    reference: picklist,
    expects: options
      .map((option) => (typeof option === "string" ? `"${option}"` : `${option}`))
      .join(" | "),
    async: false,
    options,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (options.includes(out.value as T[number])) {
        out.typed = true
      } else {
        _addIssue(
          dataset,
          {
            kind: "schema",
            type: "picklist",
            expected: options
              .map((option) => (typeof option === "string" ? `"${option}"` : `${option}`))
              .join(" | "),
            message,
          },
          config,
        )
      }
      return out as unknown as OutputDataset<T[number]>
    },
  }
}
