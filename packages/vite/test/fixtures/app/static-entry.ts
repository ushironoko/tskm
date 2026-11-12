import { withStaticJsonSchema } from "@tskm/core/json-schema"
import { userSchemaJsonSchema } from "./src/user.schema.gen.ts"
import { userSchema } from "./src/user.schema.ts"

/**
 * Compile-time Standard JSON Schema for `userSchema`.
 * This file sits outside `include`, so the generate step that writes the sidecar
 * does not import it. `src/user.schema.ts` stays free of the generated const.
 */
export const user = withStaticJsonSchema(userSchema, userSchemaJsonSchema)
