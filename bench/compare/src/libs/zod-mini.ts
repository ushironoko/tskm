import * as z from "zod/mini"
import { emailPattern, maxId } from "../constraints.ts"

/**
 * zod's small-bundle entry (`zod/mini`), with the same constraints as `zod.ts`. Used for the
 * bundle-size reference row only; the speed and memory tables use the classic `zod` entry.
 */
export const schema = z.object({
  id: z.int().check(z.minimum(1), z.maximum(maxId)),
  name: z.string().check(z.minLength(1), z.maxLength(100)),
  email: z.string().check(z.minLength(3), z.maxLength(100), z.regex(emailPattern)),
  role: z.enum(["admin", "member", "guest"]),
  tags: z.array(z.string().check(z.minLength(1), z.maxLength(30))),
  active: z.boolean(),
  score: z.int().check(z.minimum(0), z.maximum(100)),
  address: z.object({
    city: z.string().check(z.minLength(1), z.maxLength(50)),
    zip: z.string().check(z.minLength(1), z.maxLength(12)),
  }),
})

export function parse(input: unknown): boolean {
  const result = z.safeParse(schema, input)
  if (!result.success) return false
  return result.data.id >= 1
}
