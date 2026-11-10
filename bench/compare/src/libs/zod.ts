import * as z from "zod"
import { emailPattern } from "../constraints.ts"

export const schema = z.object({
  // zod's int() is a safe-integer check, so 2^53 is rejected here as in every other library.
  id: z.number().int().min(1),
  name: z.string().min(1).max(100),
  email: z.string().min(3).max(100).regex(emailPattern),
  role: z.enum(["admin", "member", "guest"]),
  tags: z.array(z.string().min(1).max(30)),
  active: z.boolean(),
  score: z.number().int().min(0).max(100),
  address: z.object({
    city: z.string().min(1).max(50),
    zip: z.string().min(1).max(12),
  }),
})

export function parse(input: unknown): boolean {
  const result = schema.safeParse(input)
  if (!result.success) return false
  return result.data.id >= 1
}
