import type { Config } from "../types/config.ts"
import { isReject } from "../types/config.ts"
import type { MutableDataset, OutputDataset, UnknownDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { _safeAssign } from "../utils/_safeAssign.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

export interface ObjectEntries {
  readonly [key: string]: BaseSchema<unknown, unknown>
}

type Prettify<T> = { [K in keyof T]: T[K] } & {}

/** An entry whose own kind is `optional`/`nullish` (the keys faithful mode makes omittable). */
type IsOptionalEntry<S> = S extends { readonly type: "optional" } | { readonly type: "nullish" }
  ? true
  : false

export type InferObjectInput<E extends ObjectEntries> = Prettify<{
  -readonly [K in keyof E]: InferInput<E[K]>
}>

/**
 * The faithful-optional output shape: `optional`/`nullish` entries become omittable
 * (`k?:`) with the value type stripped of `undefined`, while every other entry stays a
 * required key. Used only when an object is built with `{ optionalKeys: true }`.
 */
type FaithfulObjectOutput<E extends ObjectEntries> = Prettify<
  {
    -readonly [K in keyof E as IsOptionalEntry<E[K]> extends true ? never : K]: InferOutput<E[K]>
  } & {
    -readonly [K in keyof E as IsOptionalEntry<E[K]> extends true ? K : never]?: Exclude<
      InferOutput<E[K]>,
      undefined
    >
  }
>

export type InferObjectOutput<
  E extends ObjectEntries,
  TOptionalKeys extends boolean = false,
> = TOptionalKeys extends true
  ? FaithfulObjectOutput<E>
  : Prettify<{ -readonly [K in keyof E]: InferOutput<E[K]> }>

/** Unknown-key policy: drop undeclared keys (default), reject them, or copy them through. */
export type RestMode = "strip" | "exact" | "passthrough"

/**
 * Options form of `object()`. Carries the optional trailing `message`, the opt-in
 * `optionalKeys` mode, and the unknown-key `rest` policy. Passed as a non-positional
 * object so it never collides with the trailing `message` string argument (primitive
 * contract, section 4).
 *
 * The omittable (`k?:`) output type is produced ONLY when `optionalKeys` is typed as the
 * literal `true` (an inline `{ optionalKeys: true }`, an `as const`, or an explicitly
 * `true`-typed variable). A widened `boolean` (e.g. a stored `ObjectOptions` value, or a
 * `boolean`-typed flag) resolves to the legacy required-key type, so the static type
 * never claims a key is omittable when the runtime value might be `false` and keep it.
 */
export interface ObjectOptions {
  readonly message?: string | undefined
  readonly optionalKeys?: boolean | undefined
  readonly rest?: RestMode | undefined
}

/**
 * Resolves the `optionalKeys` type flag from an options object. Only a LITERAL `true`
 * yields the omittable shape; an absent, `false`, or widened `boolean` value yields the
 * legacy required-key shape. The `[V] extends [true]` form (a non-distributive tuple
 * check) is what rejects a widened `boolean`: `[boolean] extends [true]` is `false`, while
 * `[true] extends [true]` is `true`.
 */
type OptionalKeysOf<O extends ObjectOptions> = O extends { optionalKeys: infer V }
  ? [V] extends [true]
    ? true
    : false
  : false

export interface ObjectSchema<E extends ObjectEntries, TOptionalKeys extends boolean = false>
  extends BaseSchema<InferObjectInput<E>, InferObjectOutput<E, TOptionalKeys>> {
  readonly type: "object"
  readonly reference: typeof object
  readonly entries: E
  readonly message: string | undefined
  /** Faithful optional-property mode: `optional`/`nullish` keys are omittable. */
  readonly optionalKeys: TOptionalKeys
  /**
   * Unknown-key policy. `strip` (default) drops undeclared keys; `exact` rejects them
   * with a path-precise issue; `passthrough` copies them onto the output. The TS output
   * type is the closed shape for every mode (passthrough's extra keys are not surfaced in
   * `InferObjectOutput`, a safe under-description); JSON Schema reflects the policy via
   * `additionalProperties`.
   */
  readonly rest: RestMode
}

// @__NO_SIDE_EFFECTS__
export function object<const E extends ObjectEntries>(
  entries: E,
  message?: string,
): ObjectSchema<E, false>
// @__NO_SIDE_EFFECTS__
export function object<const E extends ObjectEntries, const O extends ObjectOptions>(
  entries: E,
  options: O,
): ObjectSchema<E, OptionalKeysOf<O>>
// @__NO_SIDE_EFFECTS__
export function object<const E extends ObjectEntries>(
  entries: E,
  arg?: string | ObjectOptions,
): ObjectSchema<E, boolean> {
  const options: ObjectOptions = typeof arg === "string" ? { message: arg } : (arg ?? {})
  const message = options.message
  const optionalKeys = options.optionalKeys === true
  const rest: RestMode = options.rest ?? "strip"
  return {
    kind: "schema",
    type: "object",
    reference: object,
    expects: "Object",
    async: false,
    entries,
    message,
    optionalKeys,
    rest,
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
        // Own keys only, matching `_applyRest`'s `Object.hasOwn` check and the compiler
        // walkers, so an inherited entry key cannot be flagged as unexpected in exact mode.
        for (const key of Object.keys(entries)) {
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
            if (hasErrorIssue(valueDataset.issues) && isReject(config)) {
              out.typed = false
              aborted = true
              break
            }
          }
          if (!valueDataset.typed) {
            out.typed = false
          }
          // Faithful optional-property mode: an optional/nullish entry whose output is
          // `undefined` is left absent rather than written, so the output matches the
          // omittable `k?:` type (whose value excludes `undefined`). The condition is on
          // the OUTPUT value, so an explicit `{ k: undefined }` input is dropped exactly
          // like a missing key, and an optional with a default keeps the default. Off by
          // default, so the key is always written (legacy behavior).
          if (
            optionalKeys &&
            valueDataset.value === undefined &&
            (valueSchema.type === "optional" || valueSchema.type === "nullish")
          ) {
            continue
          }
          _safeAssign(output, key, valueDataset.value)
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
      return out as unknown as OutputDataset<InferObjectOutput<E, boolean>>
    },
  }
}

/**
 * Closed-object factory: rejects any key not declared in `entries` with a path-precise
 * issue, instead of silently dropping it. The natural precondition for a sound
 * discriminated-union member. Equivalent to `object(entries, { rest: "exact" })`.
 */
// @__NO_SIDE_EFFECTS__
export function exactObject<const E extends ObjectEntries>(
  entries: E,
  message?: string,
): ObjectSchema<E, false> {
  return object(entries, { rest: "exact", message })
}

/**
 * Applies the non-strip unknown-key policy after the declared entries are walked: in
 * `passthrough` mode it copies each undeclared input key onto the output; in `exact` mode
 * it pushes a path-precise issue per undeclared key (honoring `abortEarly`). Shared by
 * `object` and `objectAsync`. Returns `true` if it aborted early.
 */
export function _applyRest(
  dataset: UnknownDataset | OutputDataset<unknown>,
  record: Record<string, unknown>,
  entries: { readonly [key: string]: unknown },
  output: Record<string, unknown>,
  rest: RestMode,
  message: string | undefined,
  config: Config,
): boolean {
  for (const key of Object.keys(record)) {
    if (Object.hasOwn(entries, key)) {
      continue
    }
    if (rest === "passthrough") {
      _safeAssign(output, key, record[key])
    } else {
      _addIssue(
        dataset,
        {
          kind: "schema",
          type: "object",
          expected: null,
          message: message ?? `Unexpected key "${key}"`,
          path: [{ key }],
        },
        config,
      )
      if (isReject(config)) {
        return true
      }
    }
  }
  return false
}

function _pushIssues(dataset: { issues?: Issue[] }, incoming: readonly Issue[]): void {
  if (dataset.issues) {
    dataset.issues.push(...incoming)
  } else {
    dataset.issues = [...incoming]
  }
}
