import type { StandardJSONSchemaV1 } from "../types/standard.ts"

/**
 * Targets `withJsonSchema` and `withStaticJsonSchema` both accept. Kept out of the
 * walker module so the static helper can validate a call without loading `convert.ts`.
 */
export const JSON_SCHEMA_TARGETS = ["draft-2020-12", "draft-07", "openapi-3.0"] as const

export type JsonSchemaTarget = (typeof JSON_SCHEMA_TARGETS)[number]

function fail(message: string): never {
  throw new Error(`tskm: ${message}`)
}

function isSupportedTarget(target: string): target is JsonSchemaTarget {
  return (JSON_SCHEMA_TARGETS as readonly string[]).includes(target)
}

/**
 * Reads a Standard JSON Schema options object. The messages match the walker so a bad
 * call looks the same on the runtime path and the static path.
 */
export function readJsonSchemaOptions(options: StandardJSONSchemaV1.Options): {
  readonly target: JsonSchemaTarget
  readonly name: string | undefined
} {
  if (options === null || typeof options !== "object") {
    fail("jsonSchema options must be an object with a target")
  }
  const { target, libraryOptions } = options
  if (!isSupportedTarget(target)) {
    fail(
      `unsupported JSON Schema target ${JSON.stringify(target)}. Supported targets: ${JSON_SCHEMA_TARGETS.map((item) => JSON.stringify(item)).join(", ")}.`,
    )
  }
  if (libraryOptions === undefined) {
    return { target, name: undefined }
  }
  if (
    libraryOptions === null ||
    typeof libraryOptions !== "object" ||
    Array.isArray(libraryOptions)
  ) {
    fail("jsonSchema libraryOptions must be a plain object when provided")
  }
  if (!("name" in libraryOptions) || libraryOptions.name === undefined) {
    return { target, name: undefined }
  }
  const name = libraryOptions.name
  if (typeof name !== "string" || name.length === 0 || name.includes("/") || name.includes("#")) {
    fail('jsonSchema libraryOptions.name must be a non-empty string without "/" or "#"')
  }
  return { target, name }
}
