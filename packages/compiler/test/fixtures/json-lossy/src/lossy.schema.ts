import { array, bigint, date, object, string, tuple } from "@tskm/core"

// Types JSON Schema cannot express. `tskm json-schema` refuses them by default and only
// approximates the ones listed in `jsonSchema.approximate`. The error paths name the export
// and the position inside it: `orderSchema.amount`, `orderSchema.createdAt`, `orderSchema.lines[0]`.
export const orderSchema = object({
  id: string(),
  amount: bigint(),
  createdAt: date(),
  lines: tuple([bigint()]),
  tags: array(string()),
})
