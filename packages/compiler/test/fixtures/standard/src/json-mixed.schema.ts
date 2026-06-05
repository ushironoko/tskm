import { object, string } from "@tskm/core"
import { type } from "arktype"
import * as v from "valibot"
import { z } from "zod"

// One module, four vendors: the adapter must route each export to its own
// converter and merge them into one document.
export const coreSchema = object({ id: string() })

export const zodSchema = z.object({ label: z.string(), count: z.number().optional() })

export const valibotSchema = v.object({ name: v.string() })

export const arkSchema = type({ flag: "boolean" })

// Unrepresentable in JSON Schema: must be SKIPPED with a reason, never written.
export const bigSchema = z.bigint()
