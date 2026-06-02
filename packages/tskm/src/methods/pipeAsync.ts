import type { CheckActionAsync } from "../actions/checkAsync.ts"
import type { TransformActionAsync } from "../actions/transformAsync.ts"
import type { Config } from "../types/config.ts"
import type { OutputDataset, SuccessDataset, UnknownDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type {
  BaseSchema,
  BaseSchemaAsync,
  BaseTransformation,
  BaseValidation,
} from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

type AnyBaseSchema = BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>

type AnyPipeItemAsync =
  | BaseValidation<any>
  | BaseTransformation<any, any>
  | CheckActionAsync<any>
  | TransformActionAsync<any, any>

/** Folds the item tuple, threading the type through each (sync or async) transformation. */
type PipeOutput<TItems extends readonly AnyPipeItemAsync[], TAcc> = TItems extends readonly [
  infer THead,
  ...infer TTail extends readonly AnyPipeItemAsync[],
]
  ? THead extends TransformActionAsync<any, infer TOut>
    ? PipeOutput<TTail, TOut>
    : THead extends BaseTransformation<any, infer TOut>
      ? PipeOutput<TTail, TOut>
      : PipeOutput<TTail, TAcc>
  : TAcc

export type SchemaWithPipeAsync<
  TSchema extends AnyBaseSchema,
  TItems extends readonly AnyPipeItemAsync[],
> = BaseSchemaAsync<InferInput<TSchema>, PipeOutput<TItems, InferOutput<TSchema>>> & {
  readonly pipe: readonly [TSchema, ...TItems]
}

/**
 * Async counterpart of `pipe`. Composes a (sync or async) schema with a sequence
 * of validation/transformation actions, any of which may be async. Awaits each
 * step. Returns a new async schema; the original is untouched.
 */
// @__NO_SIDE_EFFECTS__
export function pipeAsync<
  const TSchema extends AnyBaseSchema,
  const TItems extends readonly AnyPipeItemAsync[],
>(schema: TSchema, ...items: TItems): SchemaWithPipeAsync<TSchema, TItems> {
  const result = {
    ...schema,
    async: true,
    pipe: [schema, ...items] as const,
    // Redefine `~standard` AFTER the spread so it derives from the new `~run`,
    // not the original schema's (spread copies the getter as a value).
    get "~standard"() {
      return _getStandardProps(this as unknown as BaseSchemaAsync<unknown, unknown>)
    },
    async "~run"(dataset: UnknownDataset, config: Config) {
      let current = (await schema["~run"](dataset, config)) as OutputDataset<unknown>
      for (const item of items) {
        if (current.issues && (config.abortEarly || config.abortPipeEarly)) break
        if (item.kind === "transformation") {
          // Transformations only run on a well-typed value.
          if (current.typed) {
            current = (await item["~run"](
              current as SuccessDataset<unknown>,
              config,
            )) as OutputDataset<unknown>
          }
        } else {
          current = (await item["~run"](current, config)) as OutputDataset<unknown>
        }
      }
      return current as OutputDataset<PipeOutput<TItems, InferOutput<TSchema>>>
    },
  }
  return result as unknown as SchemaWithPipeAsync<TSchema, TItems>
}
