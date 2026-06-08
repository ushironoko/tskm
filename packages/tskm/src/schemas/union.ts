import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

export type UnionOptions = readonly BaseSchema<unknown, unknown>[]

export interface UnionSchema<TOptions extends UnionOptions>
  extends BaseSchema<InferInput<TOptions[number]>, InferOutput<TOptions[number]>> {
  readonly type: "union"
  readonly reference: typeof union
  readonly options: TOptions
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function union<const TOptions extends UnionOptions>(
  options: TOptions,
  message?: string,
): UnionSchema<TOptions> {
  return {
    kind: "schema",
    type: "union",
    reference: union,
    expects: options.map((option) => option.expects).join(" | "),
    async: false,
    options,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      const input = out.value
      // Try each option on a FRESH dataset; the first match without an ERROR wins (a
      // member that succeeded with only warnings is a valid match, and its warnings are
      // carried onto the result).
      for (const option of options) {
        const optionDataset = option["~run"]({ value: input }, config)
        if (optionDataset.typed && !hasErrorIssue(optionDataset.issues)) {
          out.typed = true
          out.value = optionDataset.value
          if (optionDataset.issues) {
            out.issues = optionDataset.issues
          }
          return out as unknown as OutputDataset<InferOutput<TOptions[number]>>
        }
      }
      // No option matched — emit a single union schema issue.
      _addIssue(
        dataset,
        {
          kind: "schema",
          type: "union",
          expected: options.map((option) => option.expects).join(" | "),
          message,
        },
        config,
      )
      return out as unknown as OutputDataset<InferOutput<TOptions[number]>>
    },
  }
}
