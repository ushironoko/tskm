import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

/** A default for a wrapped value: either a literal or a lazy getter. */
export type NullableDefault<TWrapped extends BaseSchema<unknown, unknown>> =
  | InferInput<TWrapped>
  | (() => InferInput<TWrapped>)

export interface NullableSchema<TWrapped extends BaseSchema<unknown, unknown>>
  extends BaseSchema<InferInput<TWrapped> | null, InferOutput<TWrapped> | null> {
  readonly type: "nullable"
  readonly reference: typeof nullable
  readonly wrapped: TWrapped
  readonly default: NullableDefault<TWrapped> | undefined
}

// @__NO_SIDE_EFFECTS__
export function nullable<TWrapped extends BaseSchema<unknown, unknown>>(
  wrapped: TWrapped,
  default_?: NullableDefault<TWrapped>,
): NullableSchema<TWrapped> {
  return {
    kind: "schema",
    type: "nullable",
    reference: nullable,
    expects: `(${wrapped.expects} | null)`,
    async: false,
    wrapped,
    default: default_,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (out.value === null) {
        const fallback =
          typeof default_ === "function" ? (default_ as () => InferInput<TWrapped>)() : default_
        out.typed = true
        // No default provided keeps `null` as the typed value.
        out.value = default_ === undefined ? null : fallback
        return out as unknown as OutputDataset<InferOutput<TWrapped> | null>
      }
      return wrapped["~run"](dataset, config) as OutputDataset<InferOutput<TWrapped> | null>
    },
  }
}
