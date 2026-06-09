import {
  array,
  boolean,
  type Infer,
  nullish,
  number,
  object,
  optional,
  record,
  string,
} from "@tskm/core"

export const productSchema = object({
  id: string(),
  title: string(),
  price: number(),
  inStock: boolean(),
  attributes: record(string(), string()),
  discount: nullish(number()),
})
export type Product = Infer<typeof productSchema>

export const catalogSchema = object({
  vendor: string(),
  products: array(productSchema),
  featured: optional(array(string())),
})
export type Catalog = Infer<typeof catalogSchema>
