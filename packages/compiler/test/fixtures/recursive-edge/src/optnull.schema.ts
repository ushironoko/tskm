import { nullable, nullish, object, optional, recursive, string } from "@tskm/core"

// optional/nullish/nullable INSIDE a recursive object: keys must stay REQUIRED with
// the union on the value — `object()`'s parser writes every entry key and
// `InferObjectOutput` carries no `?` modifier.
export const optNullSchema = recursive((self) =>
  object({
    name: string(),
    next: optional(self),
    alt: nullish(self),
    other: nullable(self),
  }),
)
