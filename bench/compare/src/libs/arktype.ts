import { type } from "arktype"

// `email` is the expression in constraints.ts written as a literal: arktype needs the literal
// for its type checker (a computed string fails with TS2589). agreement.ts checks they match.
export const schema = type({
  id: "1 <= number.integer <= 9007199254740991",
  name: "1 <= string <= 100",
  email:
    "(3 <= string <= 100) & /^[\\w+-]+(?:\\.[\\w+-]+)*@[\\da-zA-Z]+(?:[.-][\\da-zA-Z]+)*\\.[a-zA-Z]{2,}$/",
  role: "'admin' | 'member' | 'guest'",
  tags: "(1 <= string <= 30)[]",
  active: "boolean",
  score: "0 <= number.integer <= 100",
  address: {
    city: "1 <= string <= 50",
    zip: "1 <= string <= 12",
  },
})

export function parse(input: unknown): boolean {
  const result = schema["~standard"].validate(input)
  if (result instanceof Promise) {
    throw new Error("arktype standard validate returned a promise")
  }
  if (result.issues) return false
  const value = result.value as { id: number }
  return value.id >= 1
}
