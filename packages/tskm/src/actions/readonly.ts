import type { OutputDataset } from "../types/dataset.ts"
import type { BaseTransformation } from "../types/schema.ts"

export interface ReadonlyAction<TInput> extends BaseTransformation<TInput, Readonly<TInput>> {
  readonly type: "readonly"
  readonly reference: typeof readonly
}

// @__NO_SIDE_EFFECTS__
export function readonly<TInput>(): ReadonlyAction<TInput> {
  return {
    kind: "transformation",
    type: "readonly",
    reference: readonly,
    async: false,
    "~run"(dataset) {
      // `readonly` is a compile-time-only refinement; the runtime value is unchanged.
      return dataset as unknown as OutputDataset<Readonly<TInput>>
    },
  }
}
