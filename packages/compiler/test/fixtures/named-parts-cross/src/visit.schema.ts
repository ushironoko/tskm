import { number, object, string } from "@tskm/core"
import { addressSchema } from "./address.schema.ts"

// `addressSchema` is declared in another module. Naming it here would need an import from that
// module's sidecar, so this use stays inline (the documented fallback for cross-file parts).
export const visitSchema = object({ at: addressSchema, note: string(), count: number() })
