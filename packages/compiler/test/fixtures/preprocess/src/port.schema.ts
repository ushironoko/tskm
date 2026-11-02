import { boolean, maxValue, minValue, number, object, pipe, preprocess } from "@tskm/core"

export const portSchema = pipe(
  preprocess((value) => {
    if (typeof value !== "string") return value
    return Number(value)
  }, number()),
  minValue(1),
  maxValue(65535),
)

export const serverSchema = object({
  port: pipe(
    preprocess((value) => {
      if (typeof value !== "string") return value
      return Number(value)
    }, number()),
    minValue(1),
    maxValue(65535),
  ),
  verbose: preprocess((value) => {
    if (typeof value !== "string") return value
    return value === "true" || value === "1"
  }, boolean()),
})
