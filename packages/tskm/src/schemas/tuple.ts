import { isReject } from "../types/config.ts"
import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

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
  // Hoist construction-time facts out of the hot "~run" path: the arity and a
  // plain (non-readonly, non-tuple-typed) schema list never change per parse,
  // so resolve them once here and iterate the closure copy by index below. This
  // avoids re-reading items.length each iteration and re-widening TItems[number]
  // (a union over the tuple) to BaseSchema on every element.
  const itemSchemas: BaseSchema<unknown, unknown>[] = [...items]
  const itemCount = itemSchemas.length
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
      if (Array.isArray(input) && input.length === itemCount) {
        out.typed = true
        // Build a fresh output tuple — never mutate the user's input.
        const output: unknown[] = []
        let aborted = false
        for (let index = 0; index < itemCount; index++) {
          // index is bounded by itemCount, so the element is always present; the cast only
          // sheds the "| undefined" that noUncheckedIndexedAccess adds, with no runtime cost.
          const itemSchema = itemSchemas[index] as BaseSchema<unknown, unknown>
          const itemDataset = itemSchema["~run"]({ value: input[index] }, config)
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
