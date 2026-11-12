import { number, object, string } from "@tskm/core"

// Schema source (`include` covers `src`). It does not import the sidecar.
// `../static-entry.ts` is the module that calls `withStaticJsonSchema`.
export const userSchema = object({
  id: string(),
  age: number(),
})
