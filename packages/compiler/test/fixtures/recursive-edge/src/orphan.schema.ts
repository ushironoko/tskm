import { array, object, optional, recursive, string } from "@tskm/core"

// A non-exported recursive helper: not a declared target, so any target whose walk
// reaches it fails closed (unsupported + diagnostic).
const innerSchema = recursive((self) =>
  object({
    me: optional(self),
  }),
)

// `brokenSchema` is a declared target but its walk hits the non-target helper and
// is skipped — so the `Broken` alias is never emitted.
export const brokenSchema = recursive((self) =>
  object({
    inner: innerSchema,
    kids: array(self),
  }),
)

// `mainSchema` references the DECLARED sibling target `Broken` — a legitimate alias
// reference at walk time that dangles once `brokenSchema` is skipped. The session's
// fail-closed prune must cascade and drop `Main` too, with a diagnostic.
export const mainSchema = recursive((self) =>
  object({
    name: string(),
    broken: brokenSchema,
    next: optional(self),
  }),
)
