import { isReject } from "../types/config.ts"
import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { _safeAssign } from "../utils/_safeAssign.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

/**
 * A schema usable as a record key. Object keys are always strings, so the key schema's
 * OUTPUT must be string-assignable (a `picklist` of string literals, a `templateLiteral`,
 * a `regex`-piped string). A number-output schema is rejected: at runtime the key is the
 * raw string property name, so a numeric key type would promise keys the validator never
 * produces.
 */
export type RecordKey = BaseSchema<unknown, string>

// A keyed record is a PARTIAL dictionary: the runtime only validates the input's own keys
// and never requires the full key set, so a finite key set must be omittable (`?`). The
// mapped form is also deferred, so a recursive value avoids the eager-alias TS2456 hazard.
type RecordOutput<TKey, TItem> = TKey extends RecordKey
  ? { [K in InferOutput<TKey> & PropertyKey]?: TItem }
  : Record<string, TItem>

export interface RecordSchema<
  TValue extends BaseSchema<unknown, unknown>,
  TKey extends RecordKey | undefined = undefined,
> extends BaseSchema<
    RecordOutput<TKey, InferInput<TValue>>,
    RecordOutput<TKey, InferOutput<TValue>>
  > {
  readonly type: "record"
  readonly reference: typeof record
  /** The optional key schema. `undefined` means an unconstrained `string` key. */
  readonly key: TKey
  readonly value: TValue
  readonly message: string | undefined
}

function isSchema(value: unknown): value is BaseSchema<unknown, unknown> {
  return typeof value === "object" && value !== null && "~run" in value
}

// @__NO_SIDE_EFFECTS__
export function record<TValue extends BaseSchema<unknown, unknown>>(
  value: TValue,
  message?: string,
): RecordSchema<TValue>
// @__NO_SIDE_EFFECTS__
export function record<TKey extends RecordKey, TValue extends BaseSchema<unknown, unknown>>(
  key: TKey,
  value: TValue,
  message?: string,
): RecordSchema<TValue, TKey>
// @__NO_SIDE_EFFECTS__
export function record(
  arg1: BaseSchema<unknown, unknown>,
  arg2?: BaseSchema<unknown, unknown> | string,
  arg3?: string,
): RecordSchema<BaseSchema<unknown, unknown>, RecordKey | undefined> {
  // Disambiguate `record(value, message?)` from `record(key, value, message?)` by the
  // SECOND argument's runtime shape: a schema means a key schema (so this is the keyed
  // form), a string or absent means the trailing `message`. No colliding positional.
  const keyed = isSchema(arg2)
  const key = (keyed ? arg1 : undefined) as RecordKey | undefined
  const value = (keyed ? arg2 : arg1) as BaseSchema<unknown, unknown>
  const message = keyed ? arg3 : (arg2 as string | undefined)

  return {
    kind: "schema",
    type: "record",
    reference: record,
    expects: "Object",
    async: false,
    key,
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
        // Own keys only, matching `object`/`objectAsync` and the compiler walkers.
        for (const sourceKey of Object.keys(source)) {
          // Validate the KEY against the key schema, if any, before the value. A malformed
          // key is rejected with the offending key on the issue path. The validated key
          // OUTPUT (not the raw input key) becomes the output key, so the runtime matches
          // the inferred `InferOutput<TKey>` key type even for a key-transforming schema.
          let outKey = sourceKey
          if (key !== undefined) {
            const keyDataset = key["~run"]({ value: sourceKey }, config)
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
          const valueDataset = value["~run"]({ value: source[sourceKey] }, config)
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
