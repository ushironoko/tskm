import { array, object, recursive, string } from "@tskm/core"
import { leafSchema } from "./leaf.schema.ts"

// Re-exported imported schema: it lands in this module's exports, but it is NOT a
// declared target of THIS file, so the walker must fail closed (skip + diagnostic)
// instead of emitting a dangling `Leaf` alias this sidecar never declares, and
// instead of structurally inlining a foreign subgraph.
export { leafSchema }

export const treeSchema = recursive((self) =>
  object({
    label: string(),
    leaf: leafSchema,
    kids: array(self),
  }),
)
