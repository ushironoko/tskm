import { z } from "zod"

export type CatT = { name: string; kitten?: CatT | undefined }

// Library-idiomatic self annotation: resolves to a NAMED reference (CatT),
// which the sidecar must import from this module.
export const catSchema: z.ZodType<CatT> = z.lazy(() =>
  z.object({
    name: z.string(),
    kitten: z.optional(catSchema),
  }),
)
