import * as z from "zod"

export const schema = z.object({
  id: z.number().int().min(1),
  name: z.string().min(1).max(100),
  email: z.email().min(3).max(100),
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
