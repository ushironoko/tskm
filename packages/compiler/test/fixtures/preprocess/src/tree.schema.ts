import { number, object, optional, preprocess, recursive, string } from "@tskm/core"

export const treeSchema = recursive((self) =>
  object({
    name: string(),
    score: preprocess(
      (value) => (typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value),
      number(),
    ),
    child: optional(self),
  }),
)
