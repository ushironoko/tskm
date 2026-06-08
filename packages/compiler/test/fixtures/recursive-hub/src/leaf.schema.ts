import { object, optional, recursive, string } from "@validator"

// The defining file for a recursive child built through the hub: it emits `Leaf`
// normally (Scenario A on an object root). `tree.schema.ts` imports this to exercise
// the cross-file fail-closed contract under the hub path.
export const leafSchema = recursive((self) =>
  object({
    name: string(),
    next: optional(self),
  }),
)
