import { type InferOutput, object, optional, recursive, string } from "@tskm/core"

// THE canonical authoring pattern: a recursive const plus its explicit Infer alias.
// Discovery yields two targets on the same binding with the SAME typeName; the old
// code emitted a circular `type Book = Book` thin re-export AND crashed on the
// duplicate alias. Exactly one sound `Book` must come out.
export const bookSchema = recursive((self) =>
  object({
    title: string(),
    sequel: optional(self),
  }),
)

export type Book = InferOutput<typeof bookSchema>
