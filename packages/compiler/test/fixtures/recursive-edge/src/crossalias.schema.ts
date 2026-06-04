import type { Infer } from "@tskm/core"
import type { leafSchema } from "./leaf.schema.ts"

// Cross-file alias of an IMPORTED recursive schema: discovery cannot connect it to
// a same-file `recursive(...)` const, so it rides the checker path — where the
// unroll collapses to `any` and FAILURE_TYPE_FLAGS rejects it (flags=1). The
// regression locks the FAIL-CLOSED outcome: skip + diagnostic, never a silent-any
// alias. Declare the alias in the defining file instead.
export type CrossLeaf = Infer<typeof leafSchema>
