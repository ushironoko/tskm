import type { OutputDataset } from "../types/dataset.ts"
import type { BaseTransformation } from "../types/schema.ts"

export interface TransformAction<TInput, TOutput> extends BaseTransformation<TInput, TOutput> {
  readonly type: "transform"
  readonly reference: typeof transform
  readonly operation: (input: TInput) => TOutput
}

// @__NO_SIDE_EFFECTS__
export function transform<TInput, TOutput>(
  operation: (input: TInput) => TOutput,
): TransformAction<TInput, TOutput> {
  return {
    kind: "transformation",
    type: "transform",
    reference: transform,
    async: false,
    operation,
    "~run"(dataset) {
      // The dataset stays typed; only its value is mapped to the new shape.
      ;(dataset as { value: unknown }).value = operation(dataset.value)
      return dataset as unknown as OutputDataset<TOutput>
    },
  }
}
