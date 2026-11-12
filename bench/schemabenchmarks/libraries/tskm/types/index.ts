import type { InferInput, InferOutput } from "@tskm/core"

import { productSchema } from ".."

export const schema = productSchema

export type Input = InferInput<typeof schema>

export type Output = InferOutput<typeof schema>

export const note =
  "These aliases are the inference cost of InferInput and InferOutput. A project that runs tskm gen imports the concrete types from the AOT sidecar instead."
