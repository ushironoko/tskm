import { Type } from "typebox"
import { Settings } from "typebox/system"
import { Parse } from "typebox/value"

// typebox's default `maxParseErrors` is 1: `Parse` stops at the first failing field. Every other
// adapter collects all issues on the invalid payload, so typebox is set to collect them too.
// This is process-wide; the bench runs each library in its own process for that reason.
Settings.Set({ maxParseErrors: Number.POSITIVE_INFINITY })

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
