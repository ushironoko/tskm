import { isReject } from "../types/config.ts"
import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { hasErrorIssue } from "../utils/_severity.ts"
import { _applyRest, type RestMode } from "./object.ts"

export interface ObjectEntriesAsync {
  readonly [key: string]: BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>
}

/** Options form of `objectAsync`. Mirrors the sync `rest` unknown-key policy. */
export interface ObjectOptionsAsync {
  readonly message?: string | undefined
  readonly rest?: RestMode | undefined
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
  /** Unknown-key policy (see `object`'s `rest`). The async output type stays closed. */
  readonly rest: RestMode
}

/**
 * Async counterpart of `object`. Validates each entry by awaiting its (possibly
 * async) child schema, building a fresh output object and prepending the entry
 * key to child issue paths. Always produces an `async: true` schema.
 */
// @__NO_SIDE_EFFECTS__
export function objectAsync<const E extends ObjectEntriesAsync>(
  entries: E,
  arg?: string | ObjectOptionsAsync,
): ObjectSchemaAsync<E> {
  const options: ObjectOptionsAsync = typeof arg === "string" ? { message: arg } : (arg ?? {})
  const message = options.message
  const rest: RestMode = options.rest ?? "strip"
  return {
    kind: "schema",
    type: "object",
    reference: objectAsync,
    expects: "Object",
    async: true,
    entries,
    message,
    rest,
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
        // Own keys only, matching `_applyRest` and the compiler walkers.
        for (const key of Object.keys(entries)) {
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
            if (hasErrorIssue(valueDataset.issues) && isReject(config)) {
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
        if (!aborted && rest !== "strip") {
          aborted = _applyRest(dataset, record, entries, output, rest, message, config)
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

/**
 * Async closed-object factory: rejects undeclared keys. Equivalent to
 * `objectAsync(entries, { rest: "exact" })`.
 */
// @__NO_SIDE_EFFECTS__
export function exactObjectAsync<const E extends ObjectEntriesAsync>(
  entries: E,
  message?: string,
): ObjectSchemaAsync<E> {
  return objectAsync(entries, { rest: "exact", message })
}

function _pushIssues(dataset: { issues?: Issue[] }, incoming: readonly Issue[]): void {
  if (dataset.issues) {
    dataset.issues.push(...incoming)
  } else {
    dataset.issues = [...incoming]
  }
}
