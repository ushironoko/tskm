export { userSchema } from "../src/user.schema.ts"

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
