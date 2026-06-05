import { z } from "zod"

// A plain zod schema: tskm's compiler discovers it (zod is a default
// schemaSource), confirms it through the checker's `~standard` probe, and
// materializes the inferred OUTPUT type into the sidecar.
export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().optional(),
  roles: z.array(z.string()),
  // transform: the generated type carries the POST-transform output (number)
  nameLength: z.string().transform((s) => s.length),
})

// A branded id: the sidecar imports zod's `$brand` marker so the generated
// type stays nominal.
export const userIdSchema = z.string().brand<"UserId">()

// Recursive schemas need zod's idiomatic self annotation; the generated type
// then references CategoryT by name (and imports it from this module).
export type CategoryT = { name: string; children: CategoryT[] }
export const categorySchema: z.ZodType<CategoryT> = z.lazy(() =>
  z.object({
    name: z.string(),
    children: z.array(categorySchema),
  }),
)
