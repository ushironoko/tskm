import { array, boolean, null_, number, record, recursive, string, union } from "@tskm/core"

// JSON value: union + recursion through BOTH container kinds. `record(self)` is the
// regression anchor for TS2456 — it must render as an index-signature literal, not
// `Record<string, Json>`, or the generated alias cannot compile.
export const jsonSchema = recursive((self) =>
  union([string(), number(), boolean(), null_(), array(self), record(self)]),
)
