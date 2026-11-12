import { bigint, number, object, optional, string } from "@tskm/core"

export const userSchema = object({
  name: string(),
  age: optional(number(), 0),
})

export const amountSchema = bigint()
