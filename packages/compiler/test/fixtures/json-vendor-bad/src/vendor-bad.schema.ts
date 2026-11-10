import { object, string } from "@tskm/core"
import { type } from "arktype"
import * as v from "valibot"
import { z } from "zod"

// Every export here is a Standard Schema conversion failure. The file is not written, and the
// run exits 1. Vendor schemas have no approximation, so `jsonSchema.approximate` does not help.
export const okSchema = object({ id: string() })

export const zodBigintSchema = z.object({ amount: z.bigint() })

export const zodInfinitySchema = z.object({ cap: z.literal(Number.POSITIVE_INFINITY) })

export const valibotTransformSchema = v.pipe(
  v.string(),
  v.transform((text) => text.length),
)

export const arktypeBigintSchema = type("bigint")
