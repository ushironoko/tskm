import { email, minLength, number, object, pipe, string } from "@tskm/core"

/**
 * A small object schema passed to each framework as-is.
 * Frameworks reach it through `schema["~standard"]`. No adapter wraps it.
 */
export const userSchema = object({
  name: pipe(string(), minLength(1)),
  email: pipe(string(), email()),
  age: number(),
})

export const validUser = {
  name: "Ada",
  email: "ada@example.com",
  age: 36,
}

/**
 * Rejected by `userSchema`: empty name, a non-email, and a non-number age.
 * Call sites that are statically typed cast this on purpose so the bad value
 * still reaches the runtime validator.
 */
export const invalidUser = {
  name: "",
  email: "not-an-email",
  age: "nope",
}
