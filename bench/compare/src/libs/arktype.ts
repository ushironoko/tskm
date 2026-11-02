import { type } from "arktype"

export const schema = type({
  id: "number.integer >= 1",
  name: "1 <= string <= 100",
  email: "string.email",
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
