import { type Infer, number, object, parse, pipe, string, transform } from "@tskm/core"

// A transform-bearing schema: its output type (number) is known only to the checker; the
// walker would render it `unknown`. Under the flag it must fall back to the checker type.
export const lenSchema = pipe(
  string(),
  transform((value: string) => value.length),
)

// A non-schema tskm const (`parse` returns a value, not a schema). Under the flag it must
// not emit an empty/invalid alias; it produces no output, exactly as today.
export const parsed = parse(string(), "hello")

// A named const plus an explicit Infer alias on the same binding (the canonical-fold path).
export const tagSchema = object({ tag: string(), count: number() })
export type TagAlias = Infer<typeof tagSchema>
