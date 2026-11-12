import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"
import type { StandardJSONSchemaV1 } from "../types/standard.ts"
import { type JsonSchemaTarget, readJsonSchemaOptions } from "./options.ts"

type JsonSchemaOptions = StandardJSONSchemaV1.Options

type AnySchema = BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>

/** One precomputed JSON Schema document. */
export type StaticJsonSchemaDocument = { readonly [key: string]: unknown }

/** The input and output documents for one target. Either side may be absent. */
export interface StaticJsonSchemaSide {
  readonly input?: StaticJsonSchemaDocument
  readonly output?: StaticJsonSchemaDocument
}

/**
 * Documents keyed by target, then by side. A missing target or side means that call
 * throws. The compiler emits this shape as JSON literals.
 */
export interface StaticJsonSchemaDocs {
  readonly "draft-2020-12"?: StaticJsonSchemaSide
  readonly "draft-07"?: StaticJsonSchemaSide
  readonly "openapi-3.0"?: StaticJsonSchemaSide
}

function fail(message: string): never {
  throw new Error(`tskm: ${message}`)
}

function lookup(
  docs: StaticJsonSchemaDocs,
  io: "input" | "output",
  options: JsonSchemaOptions,
): Record<string, unknown> {
  const { target, name } = readJsonSchemaOptions(options)
  // Renaming a hoisted root would mean rewriting the document. This path does not.
  if (name !== undefined) {
    fail(
      "static JSON Schema does not apply libraryOptions.name. The documents are precomputed without a root name; omit name, or use withJsonSchema when the root must be renamed.",
    )
  }
  const doc = docs[target]?.[io]
  if (doc === undefined) {
    fail(
      `no static JSON Schema document for ${io} target ${JSON.stringify(target)}. The compiler did not emit one.`,
    )
  }
  return doc
}

/**
 * Returns a new schema whose `~standard.jsonSchema` reads precomputed documents.
 *
 * `docs` is keyed by target (`draft-2020-12`, `draft-07`, `openapi-3.0`) and then
 * by `input` / `output`. `input` and `output` return that object. They do not walk
 * the schema. A target or side that was not emitted throws when called.
 *
 * The argument is not mutated. `~standard.validate` and the inferred types stay the
 * original schema's. This does not change `withJsonSchema`.
 */
export function withStaticJsonSchema<TSchema extends AnySchema>(
  schema: TSchema,
  docs: StaticJsonSchemaDocs,
): TSchema & StandardJSONSchemaV1<InferInput<TSchema>, InferOutput<TSchema>> {
  const base = schema["~standard"]
  const jsonSchema = {
    input(options: JsonSchemaOptions) {
      return lookup(docs, "input", options)
    },
    output(options: JsonSchemaOptions) {
      return lookup(docs, "output", options)
    },
  }
  return {
    ...schema,
    "~standard": { ...base, jsonSchema },
  } as TSchema & StandardJSONSchemaV1<InferInput<TSchema>, InferOutput<TSchema>>
}

export type { JsonSchemaTarget }
