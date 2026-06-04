import { object, optional, pipe, recursive, string, transform } from "@tskm/core"

// Monomorphic (plain-arrow) authoring + transform-in-cycle: the unroll query cannot
// instantiate a non-generic `build`, so Tier-1 must fail CLOSED and the sidecar must
// keep the Tier-2 skeleton (`tag: unknown`) — never a silent `{}`.
export const monoSchema = recursive((self) =>
  object({
    tag: pipe(
      string(),
      transform((s: string) => s.length),
    ),
    next: optional(self),
  }),
)
