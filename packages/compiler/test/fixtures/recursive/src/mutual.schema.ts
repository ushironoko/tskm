import { type GenericSchema, object, optional, recursive, string } from "@tskm/core"

// Same-file mutual recursion. The PAIR forms a type-level cycle (a -> b -> a) that
// `recursive` alone cannot break — TS7022 would fire — so ONE member carries a loose
// `GenericSchema` annotation. No structural type is ever hand-written; the precise
// mutual aliases come from the generated sidecar. (The annotated member hides its
// `build` from the checker, so a transform inside ITS cycle degrades to the Tier-2
// floor; transform-free mutual ADTs are fully materialized.)
export const aSchema: GenericSchema = recursive(() =>
  object({
    name: string(),
    b: optional(bSchema),
  }),
)

export const bSchema = recursive(() =>
  object({
    a: optional(aSchema),
  }),
)
