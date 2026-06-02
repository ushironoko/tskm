import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

/** A default for a wrapped value: either a literal or a lazy getter. */
export type NullishDefault<TWrapped extends BaseSchema<unknown, unknown>> =
  | InferInput<TWrapped>
  | (() => InferInput<TWrapped>)

export interface NullishSchema<TWrapped extends BaseSchema<unknown, unknown>>
  extends BaseSchema<
    InferInput<TWrapped> | null | undefined,
    InferOutput<TWrapped> | null | undefined
  > {
  readonly type: "nullish"
  readonly reference: typeof nullish
  readonly wrapped: TWrapped
  readonly default: NullishDefault<TWrapped> | undefined
}

// @__NO_SIDE_EFFECTS__
export function nullish<TWrapped extends BaseSchema<unknown, unknown>>(
  wrapped: TWrapped,
  default_?: NullishDefault<TWrapped>,
): NullishSchema<TWrapped> {
  return {
    kind: "schema",
    type: "nullish",
    reference: nullish,
    expects: `(${wrapped.expects} | null | undefined)`,
    async: false,
    wrapped,
    default: default_,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (out.value === null || out.value === undefined) {
        const fallback =
          typeof default_ === "function" ? (default_ as () => InferInput<TWrapped>)() : default_
        out.typed = true
        // No default provided keeps the original `null` / `undefined` value.
        out.value = default_ === undefined ? out.value : fallback
        return out as unknown as OutputDataset<InferOutput<TWrapped> | null | undefined>
      }
      return wrapped["~run"](dataset, config) as OutputDataset<
        InferOutput<TWrapped> | null | undefined
      >
    },
  }
}
