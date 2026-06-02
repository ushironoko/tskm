import type { Config } from "../types/config.ts"
import type { OutputDataset, SuccessDataset, UnknownDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema, BaseTransformation, BaseValidation } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

type AnyPipeItem = BaseValidation<any> | BaseTransformation<any, any>

/** Folds the item tuple, threading the type through each transformation. */
type PipeOutput<TItems extends readonly AnyPipeItem[], TAcc> = TItems extends readonly [
  infer THead,
  ...infer TTail extends readonly AnyPipeItem[],
]
  ? THead extends BaseTransformation<any, infer TOut>
    ? PipeOutput<TTail, TOut>
    : PipeOutput<TTail, TAcc>
  : TAcc

export type SchemaWithPipe<
  TSchema extends BaseSchema<unknown, unknown>,
  TItems extends readonly AnyPipeItem[],
> = BaseSchema<InferInput<TSchema>, PipeOutput<TItems, InferOutput<TSchema>>> & {
  readonly pipe: readonly [TSchema, ...TItems]
}

/**
 * Composes a schema with a sequence of validation/transformation actions.
 * Returns a new schema; the original is untouched.
 */
// @__NO_SIDE_EFFECTS__
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown>,
  const TItems extends readonly AnyPipeItem[],
>(schema: TSchema, ...items: TItems): SchemaWithPipe<TSchema, TItems> {
  const result = {
    ...schema,
    pipe: [schema, ...items] as const,
    // R8: redefine `~standard` AFTER the spread so it derives from the new `~run`,
    // not the original schema's (spread copies the getter as a value).
    get "~standard"() {
      return _getStandardProps(this as unknown as BaseSchema<unknown, unknown>)
    },
    "~run"(dataset: UnknownDataset, config: Config) {
      let current = schema["~run"](dataset, config) as OutputDataset<unknown>
      for (const item of items) {
        if (current.issues && (config.abortEarly || config.abortPipeEarly)) break
        if (item.kind === "transformation") {
          // Transformations only run on a well-typed value.
          if (current.typed) {
            current = item["~run"](current as SuccessDataset<unknown>, config)
          }
        } else {
          current = item["~run"](current, config)
        }
      }
      return current as OutputDataset<PipeOutput<TItems, InferOutput<TSchema>>>
    },
  }
  return result as unknown as SchemaWithPipe<TSchema, TItems>
}
