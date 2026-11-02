import type { Config } from "./config.ts"
import type { OutputDataset, SuccessDataset, UnknownDataset } from "./dataset.ts"
import type { StandardSchemaV1 } from "./standard.ts"

/**
 * Standard Schema props whose phantom `types` carrier is surfaced as PRESENT, rather
 * than the spec's optional `types?` form. This lets the vendor-neutral query
 * `(typeof schema)["~standard"]["types"]["output"]` resolve directly, without the
 * `NonNullable` the optional form forces, and is still assignable to
 * `StandardSchemaV1.Props`, so the spec contract is unchanged.
 *
 * HAZARD: `types` is type-level ONLY. No runtime field is added (the object built in
 * `_getStandardProps` omits it and is asserted to this type), so at runtime
 * `schema["~standard"].types` is `undefined`. Marking it present means TypeScript no
 * longer forces a `NonNullable`/optional check, so a type-checked runtime READ
 * (`schema["~standard"].types.output`) compiles but throws. Use it only as a type
 * (`(typeof schema)["~standard"]["types"]["output"]`), never as a value.
 */
export type StandardProps<TInput, TOutput> = Omit<
  StandardSchemaV1.Props<TInput, TOutput>,
  "types"
> & {
  readonly types: StandardSchemaV1.Types<TInput, TOutput>
}

/** A synchronous schema: a tagged plain object created by a factory function. */
export interface BaseSchema<TInput, TOutput> {
  readonly kind: "schema"
  readonly type: string
  /** Self-reference to the factory, for identity checks without `instanceof`. */
  readonly reference: (...args: any[]) => BaseSchema<any, any>
  readonly expects: string
  readonly async: false
  readonly "~standard": StandardProps<TInput, TOutput>
  readonly "~run": (dataset: UnknownDataset, config: Config) => OutputDataset<TOutput>
}

/** An asynchronous schema: `~run` returns a Promise. */
export interface BaseSchemaAsync<TInput, TOutput> {
  readonly kind: "schema"
  readonly type: string
  readonly reference: (...args: any[]) => BaseSchema<any, any> | BaseSchemaAsync<any, any>
  readonly expects: string
  readonly async: true
  readonly "~standard": StandardProps<TInput, TOutput>
  readonly "~run": (dataset: UnknownDataset, config: Config) => Promise<OutputDataset<TOutput>>
}

export type GenericSchema<TInput = unknown, TOutput = TInput> = BaseSchema<TInput, TOutput>
export type GenericSchemaAsync<TInput = unknown, TOutput = TInput> = BaseSchemaAsync<
  TInput,
  TOutput
>

/** A validation action: refines without changing the type (`TInput` === output). */
export interface BaseValidation<TInput> {
  readonly kind: "validation"
  readonly type: string
  readonly reference: (...args: any[]) => BaseValidation<any>
  readonly expects: string | null
  readonly async: false
  readonly "~run": (dataset: OutputDataset<TInput>, config: Config) => OutputDataset<TInput>
}

/** A transformation action: maps `TInput` to `TOutput`, changing the inferred type. */
export interface BaseTransformation<TInput, TOutput> {
  readonly kind: "transformation"
  readonly type: string
  readonly reference: (...args: any[]) => BaseTransformation<any, any>
  readonly async: false
  readonly "~run": (dataset: SuccessDataset<TInput>, config: Config) => OutputDataset<TOutput>
}

/**
 * A metadata action: annotates a schema without validating or transforming. It is
 * never executed — `pipe`/`pipeAsync` drop metadata items from the run list at
 * construction time, so there is no `~run` (and no `async` flag, which only exists
 * to pick the awaiting strategy for `~run`).
 *
 * HAZARD: `~types` is type-level ONLY, mirroring `StandardProps.types`. No runtime
 * field is added, so reading `action["~types"]` yields `undefined`. It exists so
 * `TInput` is anchored without a value-level carrier; use it only as a type.
 */
export interface BaseMetadata<TInput> {
  readonly kind: "metadata"
  readonly type: string
  /**
   * Self-reference to the factory, for identity checks without `instanceof`.
   * `never[]`/`unknown` instead of the `any` idiom above: `TInput` only occurs
   * covariantly here (no `~run`), so contravariant `never` params and the
   * `BaseMetadata<unknown>` top type admit every concrete factory without `any`.
   */
  readonly reference: (...args: never[]) => BaseMetadata<unknown>
  readonly "~types"?: { readonly input: TInput; readonly output: TInput } | undefined
}

export type PipeItem<TInput, TOutput> =
  | BaseValidation<TInput>
  | BaseTransformation<TInput, TOutput>
  | BaseMetadata<TInput>
