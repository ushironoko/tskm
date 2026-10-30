import { coerce, object, optional, recursive, string } from "@tskm/core"

export const treeSchema = recursive((self) =>
  object({
    name: string(),
    score: coerce.number(),
    child: optional(self),
  }),
)
