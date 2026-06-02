import { array, number, object, optional, pipe, string, transform } from "tskm"

export const accountSchema = object({
  id: string(),
  age: number(),
  roles: array(string()),
  nickname: optional(string()),
  // transform output type is known only to the type system → resolves to `number`
  nameLength: pipe(
    string(),
    transform((s: string) => s.length),
  ),
})

export const tagSchema = string()
