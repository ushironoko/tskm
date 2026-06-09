import { isReject } from "../types/config.ts"
import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

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
          // Call `~run` ON `item` (not a hoisted reference) so a custom BaseSchema whose
          // `~run` reads `this` keeps its receiver. The property read is monomorphic and cheap.
          const itemDataset = item["~run"]({ value: input[index] }, config)
          if (itemDataset.issues) {
            const head: IssuePathItem = { key: index }
            for (const issue of itemDataset.issues) {
              ;(issue as { path?: readonly IssuePathItem[] }).path = issue.path
                ? [head, ...issue.path]
                : [head]
            }
            _pushIssues(out, itemDataset.issues)
            if (hasErrorIssue(itemDataset.issues) && isReject(config)) {
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
  // Index-loop appends instead of `push(...incoming)` / `[...incoming]`: same elements in the
  // same order, but no spread (which builds an argument list / clone array and, for large issue
  // batches, can stress the call stack). This path is hot when items repeatedly produce issues.
  let target = dataset.issues
  if (target === undefined) {
    target = []
    dataset.issues = target
  }
  for (let i = 0; i < incoming.length; i++) {
    // Index is in [0, incoming.length), so the read is always present; the cast only drops the
    // `| undefined` that noUncheckedIndexedAccess adds.
    target.push(incoming[i] as Issue)
  }
}
