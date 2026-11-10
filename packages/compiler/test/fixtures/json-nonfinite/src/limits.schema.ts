import { literal, minValue, number, object, picklist, pipe } from "@tskm/core"

// Non-finite numbers that JSON cannot carry. `tskm json-schema` refuses each by default, and
// writes the document only when `nonfinite` is listed. The error paths name the export and the
// property: `limitsSchema.cap`, `limitsSchema.code`, `limitsSchema.floor`.
export const limitsSchema = object({
  cap: literal(Number.POSITIVE_INFINITY),
  code: picklist([1, Number.NaN]),
  floor: pipe(number(), minValue(Number.NEGATIVE_INFINITY)),
})
