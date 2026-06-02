import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

/** A default for a wrapped value: either a literal or a lazy getter. */
export type Default<TWrapped extends BaseSchema<unknown, unknown>> =
  | InferInput<TWrapped>
  | (() => InferInput<TWrapped>)

export interface OptionalSchema<TWrapped extends BaseSchema<unknown, unknown>>
  extends BaseSchema<InferInput<TWrapped> | undefined, InferOutput<TWrapped> | undefined> {
  readonly type: "optional"
  readonly reference: typeof optional
  readonly wrapped: TWrapped
  readonly default: Default<TWrapped> | undefined
}

// @__NO_SIDE_EFFECTS__
export function optional<TWrapped extends BaseSchema<unknown, unknown>>(
  wrapped: TWrapped,
  default_?: Default<TWrapped>,
): OptionalSchema<TWrapped> {
  return {
    kind: "schema",
    type: "optional",
    reference: optional,
    expects: `(${wrapped.expects} | undefined)`,
    async: false,
    wrapped,
    default: default_,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (out.value === undefined) {
        const fallback =
          typeof default_ === "function" ? (default_ as () => InferInput<TWrapped>)() : default_
        out.typed = true
        out.value = fallback
        return out as unknown as OutputDataset<InferOutput<TWrapped> | undefined>
      }
      return wrapped["~run"](dataset, config) as OutputDataset<InferOutput<TWrapped> | undefined>
    },
  }
}
