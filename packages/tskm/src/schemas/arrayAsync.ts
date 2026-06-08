import { isReject } from "../types/config.ts"
import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

type AnyItemSchema = BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>

export interface ArraySchemaAsync<TItem extends AnyItemSchema>
  extends BaseSchemaAsync<InferInput<TItem>[], InferOutput<TItem>[]> {
  readonly type: "array"
  readonly reference: typeof arrayAsync
  readonly item: TItem
  readonly message: string | undefined
}

/**
 * Async counterpart of `array`. Validates each element by awaiting its (possibly
 * async) item schema, building a fresh output array and prepending the numeric
 * index to child issue paths. Always produces an `async: true` schema.
 */
// @__NO_SIDE_EFFECTS__
export function arrayAsync<const TItem extends AnyItemSchema>(
  item: TItem,
  message?: string,
): ArraySchemaAsync<TItem> {
  return {
    kind: "schema",
    type: "array",
    reference: arrayAsync,
    expects: "Array",
    async: true,
    item,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    async "~run"(dataset, config) {
      const out = dataset as MutableDataset
      const input = out.value
      if (Array.isArray(input)) {
        out.typed = true
        // Build a fresh output array — never mutate the user's input.
        const output: unknown[] = []
        let aborted = false
        for (let index = 0; index < input.length; index++) {
          const valueDataset = await item["~run"]({ value: input[index] }, config)
          if (valueDataset.issues) {
            const head: IssuePathItem = { key: index }
            for (const issue of valueDataset.issues) {
              ;(issue as { path?: readonly IssuePathItem[] }).path = issue.path
                ? [head, ...issue.path]
                : [head]
            }
            _pushIssues(out, valueDataset.issues)
            if (hasErrorIssue(valueDataset.issues) && isReject(config)) {
              out.typed = false
              aborted = true
              break
            }
          }
          if (!valueDataset.typed) {
            out.typed = false
          }
          output.push(valueDataset.value)
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
