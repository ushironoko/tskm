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
  // Precompute membership once: a Set turns the per-parse linear `includes` scan
  // into an O(1) `has` lookup. Options are primitives, so identity matching in
  // the Set is the same comparison `includes` used.
  const allowed = new Set<T[number]>(options)
  // Build the expected string once (preserving the original option ordering) so
  // both the `expects` field and the failing-parse branch reuse it.
  const expected = options
    .map((option) => (typeof option === "string" ? `"${option}"` : `${option}`))
    .join(" | ")
  return {
    kind: "schema",
    type: "picklist",
    reference: picklist,
    expects: expected,
    async: false,
    options,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (allowed.has(out.value as T[number])) {
        out.typed = true
      } else {
        _addIssue(
          dataset,
          {
            kind: "schema",
            type: "picklist",
            expected,
            message,
          },
          config,
        )
      }
      return out as unknown as OutputDataset<T[number]>
    },
  }
}
