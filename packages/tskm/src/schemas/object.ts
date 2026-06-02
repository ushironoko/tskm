import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface ObjectEntries {
  readonly [key: string]: BaseSchema<unknown, unknown>
}

type Prettify<T> = { [K in keyof T]: T[K] } & {}

export type InferObjectInput<E extends ObjectEntries> = Prettify<{
  -readonly [K in keyof E]: InferInput<E[K]>
}>
export type InferObjectOutput<E extends ObjectEntries> = Prettify<{
  -readonly [K in keyof E]: InferOutput<E[K]>
}>

export interface ObjectSchema<E extends ObjectEntries>
  extends BaseSchema<InferObjectInput<E>, InferObjectOutput<E>> {
  readonly type: "object"
  readonly reference: typeof object
  readonly entries: E
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function object<const E extends ObjectEntries>(
  entries: E,
  message?: string,
): ObjectSchema<E> {
  return {
    kind: "schema",
    type: "object",
    reference: object,
    expects: "Object",
    async: false,
    entries,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      const input = out.value
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        out.typed = true
        const record = input as Record<string, unknown>
        // Build a fresh output object — never mutate the user's input.
        const output: Record<string, unknown> = {}
        let aborted = false
        for (const key in entries) {
          const valueSchema = entries[key] as BaseSchema<unknown, unknown>
          const valueDataset = valueSchema["~run"]({ value: record[key] }, config)
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
        _addIssue(dataset, { kind: "schema", type: "object", expected: "Object", message }, config)
      }
      return out as unknown as OutputDataset<InferObjectOutput<E>>
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
