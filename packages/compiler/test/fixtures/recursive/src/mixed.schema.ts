import { array, number, object, pipe, recursive, string, transform } from "@tskm/core"

// One file, both resolution paths: `treeSchema` goes through the structural worker,
// `statSchema` (transform-bearing, non-recursive) stays on the tsgo checker query.
export const treeSchema = recursive((self) =>
  object({
    label: string(),
    kids: array(self),
  }),
)

export const statSchema = pipe(
  object({ count: number() }),
  transform((v: { count: number }) => v.count),
)
