import type { StandardJSONSchemaV1 } from "../types/standard.ts"

/**
 * Converter installed by `@tskm/core/json-schema`. Kept behind a `Symbol.for`
 * slot on `globalThis` so the main bundle and the json-schema entry share one
 * registration even when a bundler inlines this module into both files.
 */
export type StandardJsonSchemaConverter = (
  schema: unknown,
  io: "input" | "output",
  options: StandardJSONSchemaV1.Options,
) => Record<string, unknown>

export const standardJsonSchemaSlot = Symbol.for("tskm.standardJsonSchema.v1")

type SlotHost = typeof globalThis & {
  [standardJsonSchemaSlot]?: StandardJsonSchemaConverter
}

const NOT_ENABLED =
  'tskm: Standard JSON Schema is not enabled. Import "@tskm/core/json-schema" before calling ~standard.jsonSchema.'

export function installStandardJsonSchema(converter: StandardJsonSchemaConverter): void {
  ;(globalThis as SlotHost)[standardJsonSchemaSlot] = converter
}

export function readStandardJsonSchema(): StandardJsonSchemaConverter {
  const converter = (globalThis as SlotHost)[standardJsonSchemaSlot]
  if (typeof converter !== "function") {
    throw new Error(NOT_ENABLED)
  }
  return converter
}
