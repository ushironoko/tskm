import { number, object, string } from "@tskm/core"

export const userSchema = object({
  id: string(),
  age: number(),
})
