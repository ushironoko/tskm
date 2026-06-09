import { parse, safeParse } from "@tskm/core"
import type { Book } from "./book.schema.gen.ts"
import { bookSchema } from "./book.schema.ts"
import type { Json } from "./json.schema.gen.ts"
import { jsonSchema } from "./json.schema.ts"
import type { Shape } from "./union.schema.gen.ts"
import { shapeSchema } from "./union.schema.ts"

// 1. Discriminated union: the generated `Shape` narrows on `kind`, with no
//    `Infer<typeof shapeSchema>` paid at the use site.
const shapes: Shape[] = [
  { kind: "circle", radius: 2 },
  { kind: "rectangle", width: 3, height: 4 },
  { kind: "text", content: "hello" },
]
for (const shape of shapes) {
  switch (shape.kind) {
    case "circle":
      console.log("circle area:", Math.PI * shape.radius ** 2)
      break
    case "rectangle":
      console.log("rect area:", shape.width * shape.height)
      break
    case "text":
      console.log("text:", shape.content)
      break
  }
}
const parsedShape = parse(shapeSchema, { kind: "circle", radius: 1 })
console.log("parsed shape kind:", parsedShape.kind)

// The tags are DATA on the schema, not a second source of truth: `.literals` enumerates them
// and `.mapping` resolves a tag to its member schema. A handler registry or exhaustive check is
// DERIVED from the schema, never re-declared by hand.
console.log("shape tags:", shapeSchema.literals.join(", ")) // circle, rectangle, text
console.log("member for 'circle' resolved from tag:", shapeSchema.mapping.has("circle"))

// 2. Recursive JSON value: the generated `Json` is self-referential AND keeps `null`.
//    These assignments force every member to exist: if codegen ever dropped `null`,
//    arrays, or the record case, `tsgo --noEmit` over this file would fail to compile.
const jsonNull: Json = null
const jsonArray: Json = [1, "two", true, null]
const jsonObject: Json = { a: 1, b: [null], c: { nested: "deep" } }
console.log("json values:", jsonNull, jsonArray, jsonObject)

const parsedJson = parse(jsonSchema, { items: [1, null, "x"], ok: true })
console.log("parsed json:", JSON.stringify(parsedJson))

// A function is not valid JSON, so the recursive union rejects it.
const notJson = safeParse(jsonSchema, () => 1)
console.log("function is valid JSON?", notJson.success)

// 3. Explicit `Infer` marker: `bookSchema` is built by a helper, so auto-discovery
//    skips it; the `export type Book = Infer<…>` marker is what made `tskm gen` emit
//    the concrete `Book` type that we import here.
const book: Book = { id: "b1", title: "Types", pages: 200 }
const bookResult = safeParse(bookSchema, book)
if (bookResult.success) {
  console.log("book ok:", bookResult.output.title)
}
