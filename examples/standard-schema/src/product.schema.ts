import * as v from "valibot"

// A plain valibot schema, same compiler, same pipeline as the zod file:
// valibot is a default schemaSource, the `~standard` probe confirms it, and
// the sidecar carries the inferred OUTPUT type.
export const productSchema = v.object({
  title: v.string(),
  tags: v.array(v.string()),
  price: v.optional(v.number()),
  // pipe + transform: the generated type carries the POST-transform output (number)
  titleLength: v.pipe(
    v.string(),
    v.transform((s) => s.length),
  ),
})

// A branded sku: the sidecar imports valibot's `Brand` marker so the
// generated type stays nominal.
export const skuSchema = v.pipe(v.string(), v.brand("Sku"))

// Recursive schemas need valibot's idiomatic self annotation
// (`GenericSchema<T>`); the generated type then references MenuT by name
// (and imports it from this module).
export type MenuT = { label: string; items: MenuT[] }
export const menuSchema: v.GenericSchema<MenuT> = v.object({
  label: v.string(),
  items: v.array(v.lazy(() => menuSchema)),
})
