import { array, boolean, null_, number, record, recursive, string, union } from "@validator"

// Scenario A: a self-recursive ROOT built via the hub-imported `recursive`, with NO
// `Infer` marker. The runtime value is byte-identical to a direct-import recursive(),
// so it must materialize the same self-referential alias:
//
//   export type Json = string | number | boolean | null | Json[] | Record<string, Json>
export const jsonSchema = recursive((self) =>
  union([string(), number(), boolean(), null_(), array(self), record(self)]),
)
