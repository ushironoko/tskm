import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface RecordSchema<TValue extends BaseSchema<unknown, unknown>>
  extends BaseSchema<Record<string, InferInput<TValue>>, Record<string, InferOutput<TValue>>> {
  readonly type: "record"
  readonly reference: typeof record
  readonly value: TValue
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function record<TValue extends BaseSchema<unknown, unknown>>(
  value: TValue,
  message?: string,
): RecordSchema<TValue> {
  return {
    kind: "schema",
    type: "record",
    reference: record,
    expects: "Object",
    async: false,
    value,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      const input = out.value
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        out.typed = true
        const source = input as Record<string, unknown>
        // Build a fresh output object — never mutate the user's input.
        const output: Record<string, unknown> = {}
        let aborted = false
        for (const key in source) {
          // Own enumerable string keys only.
          if (!Object.hasOwn(source, key)) continue
          const valueDataset = value["~run"]({ value: source[key] }, config)
          if (valueDataset.issues) {
            const head: IssuePathItem = { key }
            for (const issue of valueDataset.issues) {
              ;(issue as { path?: readonly IssuePathItem[] }).path = issue.path
                ? [head, ...issue.path]
                : [head]
            }
            _pushIssues(out, valueDataset.issues)
            if (config.abortEarly) {
              out.typed = false
              aborted = true
              break
            }
          }
          if (!valueDataset.typed) {
            out.typed = false
          }
          output[key] = valueDataset.value
        }
        if (!aborted) {
          out.value = output
        }
      } else {
        _addIssue(dataset, { kind: "schema", type: "record", expected: "Object", message }, config)
      }
      return out as unknown as OutputDataset<Record<string, InferOutput<TValue>>>
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
