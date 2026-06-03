import { array, boolean, null_, number, record, recursive, string, union } from "@tskm/core"

// A recursive (self-referential) schema, written DATA-FIRST. `recursive` passes the
// self-reference INTO the builder, so the declaring const never appears in its own
// initializer — no hand-written `type Json`, no `GenericSchema<Json>` annotation, no
// `lazy(() => …)` wrappers, and TypeScript's implicit-any rule for self-referential
// initializers (TS7022) never fires.
//
// Inference can never produce this type (a value-level self-reference collapses
// before the checker sees it), so `tskm gen` walks the runtime schema graph instead
// and materializes the named self-referential alias into json.schema.gen.ts:
//
//   export type Json = string | number | boolean | null | Json[] | Record<string, Json>
//
// (`lazy` still exists as the non-recursive defer / escape hatch; lazy-based
// recursion keeps the old hand-annotation requirement.)
export const jsonSchema = recursive((self) =>
  union([string(), number(), boolean(), null_(), array(self), record(self)]),
)
