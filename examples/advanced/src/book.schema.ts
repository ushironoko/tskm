import { type Infer, number, type ObjectEntries, object, string } from "@tskm/core"

// tskm's auto-discovery is syntactic and conservative: it only matches a *direct*
// `export const x = object(…)` (or another tskm factory). A schema returned by a HELPER is
// invisible to it: the initializer here is a call to `makeEntity`, not to a tskm factory.
function makeEntity<E extends ObjectEntries>(entries: E) {
  return object({ id: string(), ...entries })
}

export const bookSchema = makeEntity({
  title: string(),
  pages: number(),
})

// So you opt in explicitly. `export type … = Infer<typeof schema>` is the marker `tskm gen`
// keys on; it materializes the concrete `Book` type into book.schema.gen.ts. Import `Book`
// from the generated file (main.ts). This alias stays the generic, type-level form and
// exists purely to tell the compiler "also generate this one".
export type Book = Infer<typeof bookSchema>
