import { minLength, number, object, pipe, string } from "tskm"

export const userSchema = object({
  name: pipe(string(), minLength(2)),
  age: number(),
  address: object({
    city: string(),
    zip: string(),
  }),
})

export const productSchema = object({
  id: string(),
  price: number(),
})
