import { convertToJsonSchema } from "./json-schema/convert.ts"
import { installStandardJsonSchema } from "./json-schema/slot.ts"

export type { StandardJSONSchemaV1 } from "./types/standard.ts"

/**
 * Installs the Standard JSON Schema converter used by
 * `schema["~standard"].jsonSchema`.
 *
 * The walker is not part of the main `@tskm/core` entry. A bundler can drop
 * this module when the program never imports it, so schemas that only parse
 * values do not pay for JSON Schema conversion. Importing this module also
 * installs the converter (the module has a side effect); calling the function
 * is idempotent.
 */
export function enableStandardJsonSchema(): void {
  installStandardJsonSchema(convertToJsonSchema)
}

enableStandardJsonSchema()
