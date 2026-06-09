import { discriminatedUnion, literal, object, string } from "@tskm/core"

// A shared, non-recursive sub-schema referenced by several discriminated-union members.
// Off: inlined at every reference site. On (nameSharedSchemas): emitted as one `Address`
// alias and referenced by name.
export const addressSchema = object({ street: string(), city: string() })

export const homeSchema = object({ kind: literal("home"), address: addressSchema })

export const workSchema = object({ kind: literal("work"), address: addressSchema })

export const placeSchema = discriminatedUnion("kind", [homeSchema, workSchema])
