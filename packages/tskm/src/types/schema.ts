import type { Config } from "./config.ts"
import type { OutputDataset, SuccessDataset, UnknownDataset } from "./dataset.ts"
import type { StandardSchemaV1 } from "./standard.ts"

export interface SchemaTypes<TInput, TOutput> {
  readonly input: TInput
  readonly output: TOutput
}

/** A synchronous schema: a tagged plain object created by a factory function. */
export interface BaseSchema<TInput, TOutput> {
  readonly kind: "schema"
  readonly type: string
  /** Self-reference to the factory, for identity checks without `instanceof`. */
  readonly reference: (...args: any[]) => BaseSchema<any, any>
  readonly expects: string
  readonly async: false
  readonly "~standard": StandardSchemaV1.Props<TInput, TOutput>
  readonly "~run": (dataset: UnknownDataset, config: Config) => OutputDataset<TOutput>
  readonly "~types"?: SchemaTypes<TInput, TOutput> | undefined
}

/** An asynchronous schema: `~run` returns a Promise. */
export interface BaseSchemaAsync<TInput, TOutput> {
  readonly kind: "schema"
  readonly type: string
  readonly reference: (...args: any[]) => BaseSchema<any, any> | BaseSchemaAsync<any, any>
  readonly expects: string
  readonly async: true
  readonly "~standard": StandardSchemaV1.Props<TInput, TOutput>
  readonly "~run": (dataset: UnknownDataset, config: Config) => Promise<OutputDataset<TOutput>>
  readonly "~types"?: SchemaTypes<TInput, TOutput> | undefined
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

export type PipeItem<TInput, TOutput> = BaseValidation<TInput> | BaseTransformation<TInput, TOutput>
