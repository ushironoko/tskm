import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface ArraySchema<TItem extends BaseSchema<unknown, unknown>>
  extends BaseSchema<InferInput<TItem>[], InferOutput<TItem>[]> {
  readonly type: "array"
  readonly reference: typeof array
  readonly item: TItem
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function array<TItem extends BaseSchema<unknown, unknown>>(
  item: TItem,
  message?: string,
): ArraySchema<TItem> {
  return {
    kind: "schema",
    type: "array",
    reference: array,
    expects: "Array",
    async: false,
    item,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      const input = out.value
      if (Array.isArray(input)) {
        out.typed = true
        // Build a fresh output array — never mutate the user's input.
        const output: unknown[] = []
        let aborted = false
        for (let index = 0; index < input.length; index++) {
          const itemDataset = item["~run"]({ value: input[index] }, config)
          if (itemDataset.issues) {
            const head: IssuePathItem = { key: index }
            for (const issue of itemDataset.issues) {
              ;(issue as { path?: readonly IssuePathItem[] }).path = issue.path
                ? [head, ...issue.path]
                : [head]
            }
            _pushIssues(out, itemDataset.issues)
            if (config.abortEarly) {
              out.typed = false
              aborted = true
              break
            }
          }
          if (!itemDataset.typed) {
            out.typed = false
          }
          output.push(itemDataset.value)
        }
        if (!aborted) {
          out.value = output
        }
      } else {
        _addIssue(dataset, { kind: "schema", type: "array", expected: "Array", message }, config)
      }
      return out as unknown as OutputDataset<InferOutput<TItem>[]>
    },
  }
}

function _pushIssues(dataset: { issues?: Issue[] }, incoming: readonly Issue[]): void {
  if (dataset.issues) {
    dataset.issues.push(...incoming)
  } else {
    dataset.issues = [...incoming]
  }
}
