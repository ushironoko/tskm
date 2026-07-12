import type { BaseMetadata } from "../types/schema.ts"

export interface DescriptionAction<TInput> extends BaseMetadata<TInput> {
  readonly type: "description"
  readonly reference: typeof description
  readonly requirement: string
}

// @__NO_SIDE_EFFECTS__
export function description<TInput>(requirement: string): DescriptionAction<TInput> {
  return {
    kind: "metadata",
    type: "description",
    reference: description,
    requirement,
  }
}
