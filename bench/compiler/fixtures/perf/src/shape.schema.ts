import { discriminatedUnion, type Infer, literal, number, object, union } from "@tskm/core"

export const shapeSchema = discriminatedUnion("kind", [
  object({ kind: literal("circle"), radius: number() }),
  object({ kind: literal("square"), side: number() }),
  object({ kind: literal("rect"), width: number(), height: number() }),
])
export type Shape = Infer<typeof shapeSchema>

export const scalarSchema = union([literal("a"), literal("b"), number()])
export type Scalar = Infer<typeof scalarSchema>
