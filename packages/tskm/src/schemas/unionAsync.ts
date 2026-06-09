import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

export type UnionOptionsAsync = readonly (
  | BaseSchema<unknown, unknown>
  | BaseSchemaAsync<unknown, unknown>
)[]

export interface UnionSchemaAsync<TOptions extends UnionOptionsAsync>
  extends BaseSchemaAsync<InferInput<TOptions[number]>, InferOutput<TOptions[number]>> {
  readonly type: "union"
  readonly reference: typeof unionAsync
  readonly options: TOptions
  readonly message: string | undefined
}

/**
 * Async counterpart of `union`. Accepts sync or async option schemas and resolves to
 * the first option that fully validates. Always produces an `async: true` schema.
 */
// @__NO_SIDE_EFFECTS__
export function unionAsync<const TOptions extends UnionOptionsAsync>(
  options: TOptions,
  message?: string,
): UnionSchemaAsync<TOptions> {
  return {
    kind: "schema",
    type: "union",
    reference: unionAsync,
    expects: options.map((option) => option.expects).join(" | "),
    async: true,
    options,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    async "~run"(dataset, config) {
      const out = dataset as MutableDataset
      const input = out.value
      // Try each option on a FRESH dataset; the first fully-valid match wins.
      for (const option of options) {
        const optionDataset = await option["~run"]({ value: input }, config)
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
