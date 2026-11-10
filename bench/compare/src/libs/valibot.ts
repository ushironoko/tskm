import * as v from "valibot"
import { emailPattern } from "../constraints.ts"

const bounded = (min: number, max: number) => v.pipe(v.string(), v.minLength(min), v.maxLength(max))

export const schema = v.object({
  id: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  name: bounded(1, 100),
  email: v.pipe(v.string(), v.minLength(3), v.maxLength(100), v.regex(emailPattern)),
  role: v.picklist(["admin", "member", "guest"]),
  tags: v.array(bounded(1, 30)),
  active: v.boolean(),
  score: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)),
  address: v.object({
    city: bounded(1, 50),
    zip: bounded(1, 12),
  }),
})

export function parse(input: unknown): boolean {
  const result = v.safeParse(schema, input)
  if (!result.success) return false
  return result.output.id >= 1
}
