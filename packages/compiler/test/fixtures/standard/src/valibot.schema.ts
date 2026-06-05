import * as v from "valibot"

export interface VNode {
  value: number
  children: VNode[]
}

export const userSchema = v.object({
  name: v.string(),
  age: v.optional(v.number()),
  score: v.pipe(
    v.string(),
    v.transform((s) => s.length),
  ),
})

// GenericSchema annotation: the rendered type references VNode by name.
export const nodeSchema: v.GenericSchema<VNode> = v.object({
  value: v.number(),
  children: v.array(v.lazy(() => nodeSchema)),
})

// Brand: leaks valibot's `Brand<"Uid">` marker -> needs the import slot.
export const uidSchema = v.pipe(v.string(), v.brand("Uid"))
