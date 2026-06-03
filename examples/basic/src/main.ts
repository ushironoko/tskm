import { safeParse } from "@tskm/core"
import type { Product, User } from "./user.schema.gen.ts"
import { productSchema, userSchema } from "./user.schema.ts"

// The generated types are concrete — no `Infer<typeof schema>` at the use site, so the
// type system pays nothing to consume them.
const user: User = {
  name: "Ada",
  age: 36,
  address: { city: "London", zip: "NW1" },
}

const product: Product = { id: "p_1", price: 9.99 }

// Validate at runtime with the same schema values.
const userResult = safeParse(userSchema, user)
const productResult = safeParse(productSchema, product)

if (userResult.success && productResult.success) {
  console.log("both valid:", userResult.output.name, productResult.output.id)
}

// A failing parse reports lean, path-aware issues.
const bad = safeParse(userSchema, { name: "A", age: -1, address: { city: "", zip: 0 } })
if (!bad.success) {
  for (const issue of bad.issues) {
    console.log(issue.message, issue.path?.map((p) => p.key).join("."))
  }
}
