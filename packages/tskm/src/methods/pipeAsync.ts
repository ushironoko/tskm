import type { CheckActionAsync } from "../actions/checkAsync.ts"
import type { TransformActionAsync } from "../actions/transformAsync.ts"
import type { Config } from "../types/config.ts"
import { isReject } from "../types/config.ts"
import type { OutputDataset, SuccessDataset, UnknownDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type {
  BaseMetadata,
  BaseSchema,
  BaseSchemaAsync,
  BaseTransformation,
  BaseValidation,
} from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

type AnyBaseSchema = BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>

type AnyPipeItemAsync =
  | BaseValidation<any>
  | BaseTransformation<any, any>
  | CheckActionAsync<any>
  | TransformActionAsync<any, any>

/** Items `pipeAsync` accepts: runnable actions plus inert metadata (dropped at construction). */
type AnyPipeItemAsyncOrMeta = AnyPipeItemAsync | BaseMetadata<unknown>

/** Folds the item tuple, threading the type through each (sync or async) transformation. */
type PipeOutput<TItems extends readonly AnyPipeItemAsyncOrMeta[], TAcc> = TItems extends readonly [
  infer THead,
  ...infer TTail extends readonly AnyPipeItemAsyncOrMeta[],
]
  ? THead extends TransformActionAsync<any, infer TOut>
    ? PipeOutput<TTail, TOut>
    : THead extends BaseTransformation<any, infer TOut>
      ? PipeOutput<TTail, TOut>
      : PipeOutput<TTail, TAcc>
  : TAcc

export type SchemaWithPipeAsync<
  TSchema extends AnyBaseSchema,
  TItems extends readonly AnyPipeItemAsyncOrMeta[],
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
  const TItems extends readonly AnyPipeItemAsyncOrMeta[],
>(schema: TSchema, ...items: TItems): SchemaWithPipeAsync<TSchema, TItems> {
  // Metadata items have no `~run`; drop them from the run list at construction time,
  // mirroring the sync `pipe`.
  const steps = items.filter((item): item is AnyPipeItemAsync => item.kind !== "metadata")
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
      for (const item of steps) {
        // Bail only on an ERROR-severity issue; a transform `"warning"` is non-fatal.
        if (hasErrorIssue(current.issues) && (isReject(config) || config.abortPipeEarly)) break
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
