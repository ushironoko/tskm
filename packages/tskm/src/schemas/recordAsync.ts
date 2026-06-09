import { isReject } from "../types/config.ts"
import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { _safeAssign } from "../utils/_safeAssign.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

/** A sync or async schema usable as an async record key (see sync `RecordKey`). */
export type RecordKeyAsync = BaseSchema<unknown, string> | BaseSchemaAsync<unknown, string>

type AnyValueSchema = BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>

// A keyed record is a PARTIAL dictionary (see sync `record`): the runtime validates only the
// input's own keys, so a finite key set must be omittable. The mapped form is also deferred.
type RecordOutputAsync<TKey, TItem> = TKey extends RecordKeyAsync
  ? { [K in InferOutput<TKey> & PropertyKey]?: TItem }
  : Record<string, TItem>

export interface RecordSchemaAsync<
  TValue extends AnyValueSchema,
  TKey extends RecordKeyAsync | undefined = undefined,
> extends BaseSchemaAsync<
    RecordOutputAsync<TKey, InferInput<TValue>>,
    RecordOutputAsync<TKey, InferOutput<TValue>>
  > {
  readonly type: "record"
  readonly reference: typeof recordAsync
  /** The optional key schema. `undefined` means an unconstrained `string` key. */
  readonly key: TKey
  readonly value: TValue
  readonly message: string | undefined
}

function isSchema(value: unknown): value is AnyValueSchema {
  return typeof value === "object" && value !== null && "~run" in value
}

/**
 * Async counterpart of `record`. Validates each key (if a key schema is given) and value by
 * awaiting their (possibly async) schemas, building a fresh output object and prepending the
 * offending key to child issue paths. Always produces an `async: true` schema. The two argument
 * forms — `recordAsync(value, message?)` and `recordAsync(key, value, message?)` — are
 * disambiguated by the second argument's runtime shape, exactly like sync `record`.
 */
// @__NO_SIDE_EFFECTS__
export function recordAsync<TValue extends AnyValueSchema>(
  value: TValue,
  message?: string,
): RecordSchemaAsync<TValue>
// @__NO_SIDE_EFFECTS__
export function recordAsync<TKey extends RecordKeyAsync, TValue extends AnyValueSchema>(
  key: TKey,
  value: TValue,
  message?: string,
): RecordSchemaAsync<TValue, TKey>
// @__NO_SIDE_EFFECTS__
export function recordAsync(
  arg1: AnyValueSchema,
  arg2?: AnyValueSchema | string,
  arg3?: string,
): RecordSchemaAsync<AnyValueSchema, RecordKeyAsync | undefined> {
  const keyed = isSchema(arg2)
  const key = (keyed ? arg1 : undefined) as RecordKeyAsync | undefined
  const value = (keyed ? arg2 : arg1) as AnyValueSchema
  const message = keyed ? arg3 : (arg2 as string | undefined)

  return {
    kind: "schema",
    type: "record",
    reference: recordAsync,
    expects: "Object",
    async: true,
    key,
    value,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    async "~run"(dataset, config) {
      const out = dataset as MutableDataset
      const input = out.value
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        out.typed = true
        const source = input as Record<string, unknown>
        // Build a fresh output object — never mutate the user's input.
        const output: Record<string, unknown> = {}
        let aborted = false
        // Own keys only, matching `record`/`object` and the compiler walkers.
        for (const sourceKey of Object.keys(source)) {
          // Validate the KEY first (see sync `record`): the validated key OUTPUT becomes the
          // output key, written `__proto__`-safely.
          let outKey = sourceKey
          if (key !== undefined) {
            const keyDataset = await key["~run"]({ value: sourceKey }, config)
            if (keyDataset.issues) {
              const head: IssuePathItem = { key: sourceKey }
              for (const issue of keyDataset.issues) {
                ;(issue as { path?: readonly IssuePathItem[] }).path = issue.path
                  ? [head, ...issue.path]
                  : [head]
              }
              _pushIssues(out, keyDataset.issues)
              if (hasErrorIssue(keyDataset.issues)) {
                out.typed = false
                if (isReject(config)) {
                  aborted = true
                  break
                }
              }
            }
            outKey = String(keyDataset.value)
          }
          const valueDataset = await value["~run"]({ value: source[sourceKey] }, config)
          if (valueDataset.issues) {
            const head: IssuePathItem = { key: sourceKey }
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
          _safeAssign(output, outKey, valueDataset.value)
        }
        if (!aborted) {
          out.value = output
        }
      } else {
        _addIssue(dataset, { kind: "schema", type: "record", expected: "Object", message }, config)
      }
      return out as unknown as OutputDataset<
        Record<string, InferOutput<BaseSchema<unknown, unknown>>>
      >
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
