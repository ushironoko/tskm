import { z } from "zod"

// The annotation type is exported only under an ALIAS: importers never see
// `AliasCatT`, so the sidecar must rebind on import
// (`import type { PublicCatT as AliasCatT }`).
type AliasCatT = { name: string; kitten?: AliasCatT | undefined }

export type { AliasCatT as PublicCatT }

export const aliasCatSchema: z.ZodType<AliasCatT> = z.lazy(() =>
  z.object({
    name: z.string(),
    kitten: z.optional(aliasCatSchema),
  }),
)
