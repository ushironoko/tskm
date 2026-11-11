import { object, string } from "@tskm/core"
import * as v from "valibot"

// A tskm object whose declared name is `Brand`, the identifier valibot's brand marker leaks as.
export const brandSchema = object({ name: string() })

// Its inner object has the same body as `brandSchema`. Naming that part `Brand` would add a
// reference that makes `import type { Brand } from "valibot"` necessary, and that import would
// clash with the `Brand` alias. The reserved-name guard keeps the part inline.
export const pairSchema = v.object({ owner: v.object({ name: v.string() }), id: v.string() })
