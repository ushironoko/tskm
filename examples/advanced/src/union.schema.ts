import { literal, number, object, string, union } from "@tskm/core"

// A discriminated union: every member carries a `kind` literal, so the type system can
// narrow on it. `tskm gen` materializes the whole union into a concrete `Shape` type —
// no `Infer<typeof shapeSchema>` is paid at the use site (see main.ts).
export const shapeSchema = union([
  object({ kind: literal("circle"), radius: number() }),
  object({ kind: literal("rectangle"), width: number(), height: number() }),
  object({ kind: literal("text"), content: string() }),
])
