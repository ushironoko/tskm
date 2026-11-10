import { array, discriminatedUnion, literal, number, object, optional, string } from "@tskm/core"

// An exported object schema used as a part of another schema is written by its name.
export const addressSchema = object({ street: string(), city: string() })

export const contactSchema = object({ email: string(), phone: optional(string()) })

// A part used directly, under an optional wrapper, and as an array element.
export const profileSchema = object({
  name: string(),
  address: addressSchema,
  home: optional(addressSchema),
  contacts: array(contactSchema),
})

// A discriminated union with inline members: the union is the part, and it is named at each use.
export const shapeSchema = discriminatedUnion("kind", [
  object({ kind: literal("circle"), radius: number() }),
  object({ kind: literal("square"), side: number() }),
])

export const drawingSchema = object({ title: string(), shape: shapeSchema, backup: shapeSchema })

// A second export with the same body as `addressSchema`. The first declaration is referenced.
export const billingAddressSchema = object({ street: string(), city: string() })

export const orderSchema = object({ billing: billingAddressSchema, ship: addressSchema })

// Two exports that derive the same type name (`User`). The first wins; the second is skipped,
// so its uses stay inline and nothing references a name that was never emitted.
export const user = object({ id: string() })
export const userSchema = object({ id: string(), name: string() })

export const accountSchema = object({ owner: user, backup: userSchema })
