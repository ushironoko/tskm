import { array, boolean, type Infer, number, object, optional, string } from "@tskm/core"

export const userSchema = object({
  id: string(),
  name: string(),
  email: string(),
  age: number(),
  active: boolean(),
  nickname: optional(string()),
  tags: array(string()),
})
export type User = Infer<typeof userSchema>

export const profileSchema = object({
  bio: optional(string()),
  avatarUrl: optional(string()),
  followers: number(),
})
export type Profile = Infer<typeof profileSchema>
