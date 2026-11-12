import { withStaticJsonSchema } from "@tskm/core/json-schema"
import { userSchemaJsonSchema } from "../src/user.schema.gen.ts"
import { userSchema } from "../src/user.schema.ts"

/**
 * Compile-time Standard JSON Schema for `userSchema`.
 *
 * `tskm gen` loads modules matched by `include` (the `src` directory). This file
 * sits outside that set, so the generate step that writes `user.schema.gen.ts`
 * does not import that sidecar. The schema module stays free of the generated const.
 */
export const staticUserSchema = withStaticJsonSchema(userSchema, userSchemaJsonSchema)
