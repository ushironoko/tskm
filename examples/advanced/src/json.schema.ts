import {
  array,
  boolean,
  type GenericSchema,
  lazy,
  null_,
  number,
  record,
  string,
  union,
} from "@tskm/core"

// A recursive (self-referential / cyclic) schema. TypeScript cannot INFER a type that
// refers to itself, so a recursive schema needs three special things:
//
//   1. Hand-write the recursive type — `Json` mentions `Json`.
//   2. Annotate the const with `GenericSchema<Json>` — this breaks the inference cycle so
//      the schema type-checks against the hand-written shape.
//   3. Wrap each self-reference in `lazy(() => jsonSchema)` so the schema object can be
//      constructed before it finishes referring to itself (the getter runs on first parse).
//
// The annotation is REQUIRED, not optional: without it the recursive position silently
// degrades to `any` (tskm's fail-closed guard only inspects the top-level type, not nested
// `any`), so codegen would quietly emit a wrong type with no diagnostic.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export const jsonSchema: GenericSchema<Json> = union([
  string(),
  number(),
  boolean(),
  null_(),
  array(lazy(() => jsonSchema)),
  record(lazy(() => jsonSchema)),
])
