import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export type TupleItems = readonly BaseSchema<unknown, unknown>[]

export type InferTupleInput<TItems extends TupleItems> = {
  -readonly [K in keyof TItems]: InferInput<TItems[K]>
}
export type InferTupleOutput<TItems extends TupleItems> = {
  -readonly [K in keyof TItems]: InferOutput<TItems[K]>
}

export interface TupleSchema<TItems extends TupleItems>
  extends BaseSchema<InferTupleInput<TItems>, InferTupleOutput<TItems>> {
  readonly type: "tuple"
  readonly reference: typeof tuple
  readonly items: TItems
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function tuple<const TItems extends TupleItems>(
  items: TItems,
  message?: string,
): TupleSchema<TItems> {
  return {
    kind: "schema",
    type: "tuple",
    reference: tuple,
    expects: "Array",
    async: false,
    items,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      const input = out.value
      if (Array.isArray(input) && input.length === items.length) {
        out.typed = true
        // Build a fresh output tuple — never mutate the user's input.
        const output: unknown[] = []
        let aborted = false
        for (let index = 0; index < items.length; index++) {
          const itemSchema = items[index] as BaseSchema<unknown, unknown>
          const itemDataset = itemSchema["~run"]({ value: input[index] }, config)
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
        _addIssue(dataset, { kind: "schema", type: "tuple", expected: "Array", message }, config)
      }
      return out as unknown as OutputDataset<InferTupleOutput<TItems>>
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
