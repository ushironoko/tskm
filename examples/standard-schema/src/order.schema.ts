import { type } from "arktype"

// arktype's string-embedded syntax still lands on `~standard`, so the same
// compiler pipeline applies — tskm has no arktype-specific handling.
export const orderSchema = type({
  id: "string",
  "note?": "string",
  // morph keyword: validates a numeric string and parses it — the generated
  // type carries the OUTPUT (number)
  qty: "string.numeric.parse",
})
