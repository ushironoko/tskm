import { z } from "zod"

// Resolution smoke target: a zod schema with the same shape battery as the
// basic tskm fixture (nesting, optional, array, transform-derived output).
export const accountSchema = z.object({
  id: z.string(),
  age: z.number().optional(),
  roles: z.array(z.string()),
  profile: z.object({ bio: z.string().nullable() }),
  nameLength: z.string().transform((s) => s.length),
})

// A non-schema export (not even a call): discovery must ignore it outright.
export const notASchema = { kind: "config" }

// A CALL rooted at a tracked import that yields a NON-schema (a plain string):
// syntactic discovery collects it as a candidate, and the checker guard must
// silently drop it — no type emitted, no diagnostic.
export const parsedValue = z.string().parse("hello")
