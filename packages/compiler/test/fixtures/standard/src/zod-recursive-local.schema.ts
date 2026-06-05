import { z } from "zod"

// The annotation type is LOCAL: the rendered reference could never compile in
// the sidecar, so the resolver must skip with the export-it diagnostic.
type CatLocalT = { name: string; kitten?: CatLocalT | undefined }

export const localCatSchema: z.ZodType<CatLocalT> = z.lazy(() =>
  z.object({
    name: z.string(),
    kitten: z.optional(localCatSchema),
  }),
)
