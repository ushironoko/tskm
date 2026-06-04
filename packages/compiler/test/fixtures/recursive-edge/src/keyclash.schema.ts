import {
  array,
  type GenericSchema,
  number,
  object,
  optional,
  pipe,
  recursive,
  string,
  transform,
} from "@tskm/core"

// A declared sibling that FAILS resolution (its walk hits a non-target recursive
// helper), so the `CategoryTree` alias is never emitted...
const innerLoop = recursive((self) =>
  object({
    me: optional(self),
  }),
)

export const categoryTreeSchema = recursive((self) =>
  object({
    inner: innerLoop,
    next: optional(self),
  }),
)

// ...while this Tier-1 root carries a property KEY spelled exactly like that
// missing alias. The key is a member declaration, not a type reference: the
// dangling-alias prune must NOT drop this sound resolution (and Tier-1
// checker-rendered bodies are not prune-scanned at all).
export const clashSchema = recursive(<S extends GenericSchema>(self: S) =>
  object({
    CategoryTree: string(),
    value: pipe(
      number(),
      transform((n: number) => n * 2),
    ),
    kids: array(self),
  }),
)
