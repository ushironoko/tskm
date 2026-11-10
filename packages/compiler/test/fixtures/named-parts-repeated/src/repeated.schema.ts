import { number, object, string, union } from "@tskm/core"

// Shared parts: `aSchema` and `bSchema` are exported object schemas, and `shapeSchema` is their union.
export const aSchema = object({ a: string() })
export const bSchema = object({ b: number() })
export const shapeSchema = union([aSchema, bSchema])

// Two identical object schemas in one union. TypeScript keeps both members (they are distinct
// types), so both stay written out: naming them `A` would collapse the union to one member.
export const twinSchema = object({
  pair: union([object({ a: string() }), object({ a: string() })]),
})

// A plain object member next to a shared union: `{ a } | A | B`. The inline `{ a }` repeats `A`.
export const mixedSchema = object({ mixed: union([object({ a: string() }), shapeSchema]) })

// The same shared object in two properties is still named in both: it is not a repeated operand.
export const pairSchema = object({ left: aSchema, right: aSchema })
