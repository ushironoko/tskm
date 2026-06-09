import { array, type Infer, number, object, pipe, string, transform } from "@tskm/core"

export const lineItemSchema = object({
  sku: string(),
  qty: number(),
  unitPrice: number(),
})
export type LineItem = Infer<typeof lineItemSchema>

export const orderSchema = object({
  orderId: string(),
  items: array(lineItemSchema),
  total: number(),
  // transform output type is known only to the checker
  summary: pipe(
    string(),
    transform((s: string) => s.length),
  ),
})
export type Order = Infer<typeof orderSchema>
