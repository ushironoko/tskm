import { type Infer, number, object, string } from "@tskm/core"

export const addressSchema = object({ street: string(), city: string() })
export type Address = Infer<typeof addressSchema>

export const profileSchema = object({ name: string(), address: addressSchema, zip: number() })
export type Profile = Infer<typeof profileSchema>
