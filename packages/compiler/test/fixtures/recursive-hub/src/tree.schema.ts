import { array, object, recursive, string } from "@validator"
import { leafSchema } from "./leaf.schema.ts"

// Scenario B under the hub path: `treeSchema` is a declared recursive root (built via
// the hub), but its body references an IMPORTED recursive schema (`leafSchema`) that
// is NOT a declared target of THIS file. Routing the hub root to the walker must NOT
// change the fail-closed contract: the walker still skips with a path-precise
// diagnostic rather than emitting a dangling `Leaf` alias or inlining a foreign graph.
export const treeSchema = recursive((self) =>
  object({
    label: string(),
    leaf: leafSchema,
    kids: array(self),
  }),
)
