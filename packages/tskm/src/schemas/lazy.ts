import type { OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export interface LazySchema<TWrapped extends BaseSchema<unknown, unknown>>
  extends BaseSchema<InferInput<TWrapped>, InferOutput<TWrapped>> {
  readonly type: "lazy"
  readonly reference: typeof lazy
  readonly getter: () => TWrapped
}

/**
 * Defers schema resolution to the first `~run`. The resolved schema is memoized in
 * a CLOSURE variable (not a module map), so it is collected together with this
 * schema. For RECURSIVE schemas prefer `recursive((self) => ...)`, which needs no
 * annotation and is materialized by the AOT compiler; recursive use of `lazy`
 * still requires an explicit type parameter, e.g. `lazy<NodeSchema>(() => node)`,
 * because TypeScript cannot infer a type that references itself.
 */
// @__NO_SIDE_EFFECTS__
export function lazy<TWrapped extends BaseSchema<unknown, unknown>>(
  getter: () => TWrapped,
): LazySchema<TWrapped> {
  let resolved: TWrapped | undefined
  return {
    kind: "schema",
    type: "lazy",
    reference: lazy,
    expects: "unknown",
    async: false,
    getter,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      if (resolved === undefined) {
        resolved = getter()
      }
      return resolved["~run"](dataset, config) as OutputDataset<InferOutput<TWrapped>>
    },
  }
}
