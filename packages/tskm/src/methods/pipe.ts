import type { Config } from "../types/config.ts"
import { isReject } from "../types/config.ts"
import type { OutputDataset, SuccessDataset, UnknownDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type {
  BaseMetadata,
  BaseSchema,
  BaseTransformation,
  BaseValidation,
} from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { hasErrorIssue } from "../utils/_severity.ts"

type AnyPipeItem = BaseValidation<any> | BaseTransformation<any, any>

/** Items `pipe` accepts: runnable actions plus inert metadata (dropped at construction). */
type AnyPipeItemOrMeta = AnyPipeItem | BaseMetadata<unknown>

/** Folds the item tuple, threading the type through each transformation. */
type PipeOutput<TItems extends readonly AnyPipeItemOrMeta[], TAcc> = TItems extends readonly [
  infer THead,
  ...infer TTail extends readonly AnyPipeItemOrMeta[],
]
  ? THead extends BaseTransformation<any, infer TOut>
    ? PipeOutput<TTail, TOut>
    : PipeOutput<TTail, TAcc>
  : TAcc

export type SchemaWithPipe<
  TSchema extends BaseSchema<unknown, unknown>,
  TItems extends readonly AnyPipeItemOrMeta[],
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
  const TItems extends readonly AnyPipeItemOrMeta[],
>(schema: TSchema, ...items: TItems): SchemaWithPipe<TSchema, TItems> {
  // The item kinds are fixed at construction time, so classify each item once here
  // instead of re-comparing `item.kind` against the string on every parse. Metadata
  // items have no `~run` and are dropped from the run list entirely. Each remaining step
  // carries a precomputed `isTransform` boolean the hot loop reads directly, paired with
  // the item already narrowed to its concrete action type so the loop keeps the original
  // discriminated `~run` signatures (no per-parse re-narrowing, no widening cast).
  const steps = items
    .filter((item): item is AnyPipeItem => item.kind !== "metadata")
    .map((item) =>
      item.kind === "transformation"
        ? ({ isTransform: true, item } as const)
        : ({ isTransform: false, item } as const),
    )

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
      for (const { item, isTransform } of steps) {
        // Bail only on an ERROR-severity issue; a transform `"warning"` is non-fatal and
        // must not short-circuit the remaining pipeline items. Truthy (not `=== true`) test to
        // match the async sibling and accept any abort-early config value the same way.
        if (hasErrorIssue(current.issues) && (isReject(config) || config.abortPipeEarly)) break
        if (isTransform) {
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
