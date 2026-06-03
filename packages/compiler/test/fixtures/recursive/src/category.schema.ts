import { array, object, recursive, string } from "@tskm/core"

// The headline case: a self-recursive ADT with NO hand-written type annotation.
export const categorySchema = recursive((self) =>
  object({
    name: string(),
    children: array(self),
  }),
)
