import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface ObjectEntriesAsync {
  readonly [key: string]: BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>
}

type Prettify<T> = { [K in keyof T]: T[K] } & {}

export type InferObjectInputAsync<E extends ObjectEntriesAsync> = Prettify<{
  [K in keyof E]: InferInput<E[K]>
}>
export type InferObjectOutputAsync<E extends ObjectEntriesAsync> = Prettify<{
  [K in keyof E]: InferOutput<E[K]>
}>

export interface ObjectSchemaAsync<E extends ObjectEntriesAsync>
  extends BaseSchemaAsync<InferObjectInputAsync<E>, InferObjectOutputAsync<E>> {
  readonly type: "object"
  readonly reference: typeof objectAsync
  readonly entries: E
  readonly message: string | undefined
}

/**
 * Async counterpart of `object`. Validates each entry by awaiting its (possibly
 * async) child schema, building a fresh output object and prepending the entry
 * key to child issue paths. Always produces an `async: true` schema.
 */
// @__NO_SIDE_EFFECTS__
export function objectAsync<const E extends ObjectEntriesAsync>(
  entries: E,
  message?: string,
): ObjectSchemaAsync<E> {
  return {
    kind: "schema",
    type: "object",
    reference: objectAsync,
    expects: "Object",
    async: true,
    entries,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    async "~run"(dataset, config) {
      const out = dataset as MutableDataset
      const input = out.value
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        out.typed = true
        const record = input as Record<string, unknown>
        // Build a fresh output object — never mutate the user's input.
        const output: Record<string, unknown> = {}
        let aborted = false
        for (const key in entries) {
          const valueSchema = entries[key] as
            | BaseSchema<unknown, unknown>
            | BaseSchemaAsync<unknown, unknown>
          const valueDataset = await valueSchema["~run"]({ value: record[key] }, config)
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
      return out as unknown as OutputDataset<InferObjectOutputAsync<E>>
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
