import { number, object, optional, preprocess, recursive, string } from "@tskm/core"

export const treeSchema = recursive((self) =>
  object({
    name: string(),
    score: preprocess((value) => {
      if (typeof value !== "string") return value
      return Number(value)
    }, number()),
    child: optional(self),
  }),
)
