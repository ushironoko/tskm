import { bigint, object, string } from "@tskm/core"

// goodSchema produces a static JSON Schema document (written into the sidecar).
export const goodSchema = object({ id: string() })

// bigint has no JSON Schema representation, so static emit fails closed for it:
// `result.errors` is non-empty and `tskm gen` must exit 1.
export const amountSchema = bigint()
