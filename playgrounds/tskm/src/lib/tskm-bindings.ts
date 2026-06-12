import * as tskm from "@tskm/core"

export const tskmBindings = {
  ...tskm,
  t: tskm,
  tskm,
} as const

export const schemaIdentifiers = [
  "any",
  "array",
  "arrayAsync",
  "bigint",
  "boolean",
  "date",
  "discriminatedUnion",
  "discriminatedUnionAsync",
  "exactObject",
  "exactObjectAsync",
  "lazy",
  "literal",
  "never_",
  "null_",
  "nullable",
  "nullish",
  "number",
  "object",
  "objectAsync",
  "optional",
  "picklist",
  "record",
  "recordAsync",
  "recursive",
  "string",
  "templateLiteral",
  "tuple",
  "undefined_",
  "union",
  "unionAsync",
  "unknown",
] as const

export const actionIdentifiers = [
  "brand",
  "check",
  "checkAsync",
  "email",
  "integer",
  "length",
  "maxLength",
  "maxValue",
  "minLength",
  "minValue",
  "multipleOf",
  "nonEmpty",
  "pipe",
  "pipeAsync",
  "readonly",
  "regex",
  "transform",
  "transformAsync",
  "url",
] as const

export const methodIdentifiers = [
  "assert",
  "fallback",
  "flatten",
  "getDotPath",
  "is",
  "parse",
  "parseAsync",
  "safeParse",
  "safeParseAsync",
  "tskmError",
] as const

export type TskmIdentifierKind = "schema" | "action" | "method"

export const tskmIdentifierKinds: Record<string, TskmIdentifierKind> = Object.fromEntries([
  ...schemaIdentifiers.map((name) => [name, "schema"] as const),
  ...actionIdentifiers.map((name) => [name, "action"] as const),
  ...methodIdentifiers.map((name) => [name, "method"] as const),
])
