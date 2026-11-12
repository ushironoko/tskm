import { email, minLength, number, object, pipe, string } from "@tskm/core"

/**
 * A small object schema passed to each framework as-is.
 * Frameworks reach it through `schema["~standard"]`. No adapter wraps it.
 *
 * This file is the schema source (`include` covers `src`). It does not import the
 * sidecar. `shared/static-user.ts` is the module that calls `withStaticJsonSchema`.
 */
export const userSchema = object({
  name: pipe(string(), minLength(1)),
  email: pipe(string(), email()),
  age: number(),
})
