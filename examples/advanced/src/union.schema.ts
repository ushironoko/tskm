import { discriminatedUnion, literal, number, object, string } from "@tskm/core"

// A discriminated union: every member tags itself with a `kind` literal. `discriminatedUnion`
// reads those tags at construction time and dispatches on `kind` in O(1) (one Map lookup per
// parse) instead of trying every member linearly like a plain `union`. It also exposes the tag
// set as data — `.discriminant`, `.literals`, and `.mapping` (tag -> member) — so a registry or
// exhaustive `switch` can be DERIVED from the schema instead of re-declared by hand (see main.ts).
//
// `tskm gen` materializes the whole union into a concrete `Shape` type — no `Infer<typeof
// shapeSchema>` is paid at the use site. The generated type is the same union a plain
// `union([...])` would emit; what `discriminatedUnion` adds is O(1) runtime dispatch and the
// tag metadata, from one schema declaration.
export const shapeSchema = discriminatedUnion("kind", [
  object({ kind: literal("circle"), radius: number() }),
  object({ kind: literal("rectangle"), width: number(), height: number() }),
  object({ kind: literal("text"), content: string() }),
])
