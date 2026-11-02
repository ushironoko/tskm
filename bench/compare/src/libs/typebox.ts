import { Type } from "typebox"
import { Parse } from "typebox/value"

export const schema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  email: Type.String({ format: "email", minLength: 3, maxLength: 100 }),
  role: Type.Union([Type.Literal("admin"), Type.Literal("member"), Type.Literal("guest")]),
  tags: Type.Array(Type.String({ minLength: 1, maxLength: 30 })),
  active: Type.Boolean(),
  score: Type.Integer({ minimum: 0, maximum: 100 }),
  address: Type.Object({
    city: Type.String({ minLength: 1, maxLength: 50 }),
    zip: Type.String({ minLength: 1, maxLength: 12 }),
  }),
})

export function parse(input: unknown): boolean {
  try {
    const value = Parse(schema, input) as { id: number }
    return value.id >= 1
  } catch {
    return false
  }
}
