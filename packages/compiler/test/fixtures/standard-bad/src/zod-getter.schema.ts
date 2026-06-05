import { z } from "zod"

// Annotation-FREE getter recursion: the self reference is a use-before-
// declaration type error, so the whole inferred type collapses to `any`, the
// checker guard rejects the candidate, and the resolver emits the
// version/annotation hint instead of a wrong type.
export const catSchema = z.object({
  name: z.string(),
  get kitten() {
    return catSchema
  },
})
