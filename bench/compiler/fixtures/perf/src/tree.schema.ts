import { array, type Infer, number, object, optional, string } from "@tskm/core"

// Deeply nested but non-recursive: stresses the checker's full structural expansion.
export const orgSchema = object({
  name: string(),
  ceo: object({
    name: string(),
    reports: array(
      object({
        name: string(),
        title: string(),
        team: object({
          size: number(),
          lead: object({ name: string(), email: optional(string()) }),
        }),
      }),
    ),
  }),
})
export type Org = Infer<typeof orgSchema>
