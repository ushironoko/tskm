import type { OutputDataset } from "../types/dataset.ts"
import type { BaseTransformation } from "../types/schema.ts"

export interface DescriptionAction<TInput> extends BaseTransformation<TInput, TInput> {
  readonly type: "description"
  readonly reference: typeof description
  readonly requirement: string
}

// @__NO_SIDE_EFFECTS__
export function description<TInput>(requirement: string): DescriptionAction<TInput> {
  return {
    kind: "transformation",
    type: "description",
    reference: description,
    async: false,
    requirement,
    "~run"(dataset) {
      // `description` is metadata-only; the runtime value is unchanged.
      return dataset as OutputDataset<TInput>
    },
  }
}
