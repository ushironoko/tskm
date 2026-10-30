import { boolean, coerce, maxValue, minValue, object, pipe, preprocess } from "@tskm/core"

export const portSchema = pipe(coerce.number(), minValue(1), maxValue(65535))

export const serverSchema = object({
  port: pipe(coerce.number(), minValue(1), maxValue(65535)),
  verbose: preprocess((value) => {
    if (typeof value !== "string") return value
    return value === "true" || value === "1"
  }, boolean()),
})
