import { object, optional, recursive, string } from "@tskm/core"

// The defining file: emits `Leaf` normally. Other fixtures import this schema to
// exercise the cross-file fail-closed contracts.
export const leafSchema = recursive((self) =>
  object({
    name: string(),
    next: optional(self),
  }),
)
