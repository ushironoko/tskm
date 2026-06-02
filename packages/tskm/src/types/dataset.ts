import type { Issue } from "./issue.ts"

/** Input dataset handed to a schema's `~run`. */
export interface UnknownDataset {
  typed?: false
  value: unknown
  issues?: undefined
}

/** Right shape, no issues. */
export interface SuccessDataset<Value> {
  typed: true
  value: Value
  issues?: undefined
}

/** Right shape, but one or more refinement issues (e.g. a failed `minLength`). */
export interface PartialDataset<Value> {
  typed: true
  value: Value
  issues: [Issue, ...Issue[]]
}

/** Wrong shape. */
export interface FailureDataset {
  typed: false
  value: unknown
  issues: [Issue, ...Issue[]]
}

export type OutputDataset<Value> = SuccessDataset<Value> | PartialDataset<Value> | FailureDataset

/** Internal mutable view used inside `~run` while accumulating typed/value/issues. */
export type MutableDataset = {
  typed?: boolean
  value: unknown
  issues?: Issue[]
}
