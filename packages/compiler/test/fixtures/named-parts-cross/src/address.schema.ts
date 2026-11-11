import { object, string } from "@tskm/core"

export const addressSchema = object({ street: string(), city: string() })
