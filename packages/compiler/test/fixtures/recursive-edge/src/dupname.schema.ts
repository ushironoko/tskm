import { object, optional, recursive, string } from "@tskm/core"

// Two DISTINCT exports whose names derive the same alias (`user` and `userSchema`
// both -> `User`). The old code crashed renderSidecar's duplicate guard and aborted
// the whole run; the session must instead keep the FIRST declaration and skip the
// later one with a diagnostic.
export const user = recursive((self) =>
  object({
    name: string(),
    boss: optional(self),
  }),
)

export const userSchema = recursive((self) =>
  object({
    id: string(),
    parent: optional(self),
  }),
)
