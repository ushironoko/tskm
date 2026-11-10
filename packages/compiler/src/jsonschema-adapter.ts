import { createRequire } from "node:module"
import type { JsonSchemaApproximation } from "./config.ts"
import { type JsonSchema, schemaToJsonSchema } from "./jsonschema.ts"
import { isTskmWalkable, readStandard } from "./worker-harness.ts"

/**
 * Vendor dispatch for JSON Schema conversion. The tskm walker only understands
 * tskm's internal object conventions, so external Standard Schemas are routed
 * to their own converters instead (codex review: this is an adapter layer with
 * per-provider errors, never a provider swap inside the walker):
 *
 *   1. tskm-walkable        -> the native duck-typed walker (jsonschema.ts)
 *   2. spec 1.1 `~standard.jsonSchema` (zod 4.4+, arktype) -> its io-specific method
 *   3. vendor "zod"         -> `z.toJSONSchema` (zod core, user's node_modules)
 *   4. vendor "valibot"     -> `@valibot/to-json-schema` (extra package)
 *   5. anything else        -> rejected: the vendor provides no converter
 *
 * Every conversion failure is `rejected`: a missing converter package, a converter that
 * throws, or a non-finite literal, enum member, or bound that the converter would write as
 * `null`. The parent fails the whole file, as it does for a tskm type the walker cannot
 * express, so nothing is written for it. A vendor schema has no approximation. A vendor
 * outside the allow-list (see `schemaSources`) is `excluded` instead: that is configuration,
 * and the document says so.
 *
 * Runs inside the isolated schema worker. The converter packages resolve from the schema
 * module's own directory first (see `importConverter`).
 */

/** The draft every converter is asked for (the tskm walker's native output). */
export const JSON_SCHEMA_TARGET = "draft-2020-12"

const VENDOR_HINT =
  "Vendor schemas have no approximation: change the schema, or leave the vendor out of schemaSources."

export interface AdapterContext {
  /** Which side to render (the tskm walker, zod, arktype, and valibot honor it). */
  readonly io: "input" | "output"
  /** Vendors enabled by config (`schemaSources`-derived); tskm is always present. */
  readonly allowedVendors: ReadonlySet<string>
  /** Identity map for the tskm walker's `$defs` naming (see jsonschema.ts). */
  readonly exportNames?: ReadonlyMap<object, string> | undefined
  /** The export name that starts the tskm walker's diagnostic paths (`User.createdAt`). */
  readonly rootName?: string
  /** Types the tskm walker may approximate instead of failing (`jsonSchema.approximate`). */
  readonly approximate?: ReadonlyArray<JsonSchemaApproximation>
  /**
   * The absolute path of the schema module. Converter packages resolve from its directory
   * first, as the module's own imports do, so the project's installed copy is used.
   */
  readonly importFrom?: string
  /**
   * DI seam for the converter imports (defaults to `importConverter`). Exists so the
   * missing-package branches are testable with the packages installed — never set in
   * production paths.
   */
  readonly importModule?: (specifier: string) => Promise<unknown>
}

export type AdapterOutcome =
  | {
      readonly kind: "converted"
      readonly schema: JsonSchema
      readonly warnings: ReadonlyArray<string>
    }
  /**
   * The schema cannot be converted: a tskm type the walker cannot express and that was not
   * approximated, or a Standard Schema whose converter failed. The parent fails the whole file.
   */
  | { readonly kind: "rejected"; readonly errors: ReadonlyArray<string> }
  /**
   * Vendor not in the config-derived allow-list — omitted from the document,
   * but the runtime vendor travels along so the parent can aggregate one
   * diagnostic per (file, vendor) instead of dropping the schema without
   * feedback (the silence would also swallow a vendor-string/package-root
   * mismatch, where the user DID configure the source).
   */
  | { readonly kind: "excluded"; readonly vendor: string }

/** The spec 1.1 converter surface: io-keyed methods taking a target option. */
interface NativeJsonSchemaConverter {
  readonly input?: (options: Record<string, unknown>) => unknown
  readonly output?: (options: Record<string, unknown>) => unknown
}

/** The parts of the zod and valibot modules this adapter calls. */
interface ZodModule {
  readonly z?: { readonly toJSONSchema?: unknown }
}
interface ValibotModule {
  readonly toJsonSchema?: unknown
}

/**
 * Imports a converter package. The project's copy comes first: it is resolved from the schema
 * module's directory, the way the module's own imports resolve. The compiler's own resolution is
 * the fallback, which covers a converter installed next to the compiler (the monorepo layout).
 * A package that is not installed in the project fails here, and the caller reports it.
 */
function importConverter(specifier: string, from: string | undefined): Promise<unknown> {
  if (from !== undefined) {
    try {
      return Promise.resolve(createRequire(from)(specifier))
    } catch {
      // Not installed for this project: fall through to the compiler's own resolution.
    }
  }
  return import(specifier)
}

/** NaN and the infinities: converters write them as `null`, which is a different value. */
function isNonFinite(value: unknown): boolean {
  return typeof value === "number" && !Number.isFinite(value)
}

interface ZodDefLike {
  readonly type?: unknown
  readonly values?: unknown
  readonly entries?: unknown
  readonly checks?: unknown
}

/**
 * zod's `override` hook, which zod calls for every node it converts (through `libraryOptions`
 * on the native converter, and as an option on `z.toJSONSchema`). zod writes a non-finite
 * literal value, enum member, or check bound as `null`, so the node is refused. Reads zod's
 * `_zod.def`, the structure zod's own converter reads.
 */
function zodNonFiniteGuard({ zodSchema }: { zodSchema: unknown }): undefined {
  const def = (zodSchema as { _zod?: { def?: ZodDefLike } } | undefined)?._zod?.def
  if (def === undefined) {
    return undefined
  }
  const literals = def.type === "literal" && Array.isArray(def.values) ? def.values : []
  const members =
    def.type === "enum" && typeof def.entries === "object" && def.entries !== null
      ? Object.values(def.entries)
      : []
  const bounds = Array.isArray(def.checks)
    ? def.checks.flatMap((check: { _zod?: { def?: object } } | undefined) =>
        Object.values(check?._zod?.def ?? {}),
      )
    : []
  const offending = [...literals, ...members, ...bounds].find(isNonFinite)
  if (offending !== undefined) {
    throw new Error(`${String(offending)} has no JSON representation`)
  }
  return undefined
}

/**
 * `@valibot/to-json-schema`'s `overrideSchema` hook, called for each schema it converts. It
 * refuses a literal or a picklist option that is non-finite, which valibot would write as `null`.
 * (valibot's pipe actions, such as `minValue(Infinity)`, are not passed to this hook.)
 */
function valibotNonFiniteGuard({ valibotSchema }: { valibotSchema: unknown }): undefined {
  const schema = (valibotSchema ?? {}) as { type?: unknown; literal?: unknown; options?: unknown }
  const values =
    schema.type === "literal"
      ? [schema.literal]
      : schema.type === "picklist" && Array.isArray(schema.options)
        ? schema.options
        : []
  const offending = values.find(isNonFinite)
  if (offending !== undefined) {
    throw new Error(`${String(offending)} has no JSON representation`)
  }
  return undefined
}

export async function schemaToJsonSchemaViaAdapter(
  value: unknown,
  ctx: AdapterContext,
): Promise<AdapterOutcome> {
  const root = ctx.rootName ?? "schema"
  // tskm first: walkable schemas (vendor "tskm" or the legacy kind form) use
  // the native walker, warnings and all.
  if (isTskmWalkable(value)) {
    const { schema, warnings, errors } = schemaToJsonSchema(value, {
      exportNames: ctx.exportNames,
      rootName: ctx.rootName,
      io: ctx.io,
      approximate: ctx.approximate,
    })
    if (errors.length > 0) {
      return { kind: "rejected", errors }
    }
    return { kind: "converted", schema, warnings }
  }

  const std = readStandard(value)
  if (!std) {
    return {
      kind: "rejected",
      errors: [`${root}: cannot convert the value to JSON Schema: it is not a Standard Schema.`],
    }
  }
  if (!ctx.allowedVendors.has(std.vendor)) {
    return { kind: "excluded", vendor: std.vendor }
  }

  const reject = (reason: string, hint = VENDOR_HINT): AdapterOutcome => ({
    kind: "rejected",
    errors: [`${root}: cannot convert ${std.vendor} schema to JSON Schema: ${reason}. ${hint}`],
  })

  // Spec 1.1 native converter (`~standard.jsonSchema.output({ target })`, zod 4.4+
  // and arktype ship it): the vendor's own conversion is the most faithful.
  const marker = (value as Record<string, unknown>)["~standard"] as Record<string, unknown>
  const native = marker.jsonSchema as NativeJsonSchemaConverter | undefined
  const method = native?.[ctx.io]
  if (typeof method === "function") {
    try {
      const options: Record<string, unknown> = { target: JSON_SCHEMA_TARGET }
      if (std.vendor === "zod") {
        options.libraryOptions = { override: zodNonFiniteGuard }
      }
      const schema = method.call(native, options) as JsonSchema
      return { kind: "converted", schema, warnings: [] }
    } catch (err) {
      return reject(`the ${std.vendor} JSON Schema converter rejected the schema (${String(err)})`)
    }
  }

  const importModule =
    ctx.importModule ?? ((specifier: string) => importConverter(specifier, ctx.importFrom))

  if (std.vendor === "zod") {
    let zod: ZodModule
    try {
      zod = (await importModule("zod")) as ZodModule
    } catch {
      return reject(
        'could not import "zod" from the project',
        "Install zod in the project, or leave the vendor out of schemaSources.",
      )
    }
    const toJSONSchema = zod.z?.toJSONSchema
    if (typeof toJSONSchema !== "function") {
      return reject(
        'the installed "zod" has no z.toJSONSchema (zod 4 provides it)',
        "Upgrade to zod 4, or leave the vendor out of schemaSources.",
      )
    }
    try {
      const schema = toJSONSchema(value, {
        io: ctx.io,
        unrepresentable: "throw",
        override: zodNonFiniteGuard,
      }) as JsonSchema
      return { kind: "converted", schema, warnings: [] }
    } catch (err) {
      return reject(`z.toJSONSchema rejected the schema (${String(err)})`)
    }
  }

  if (std.vendor === "valibot") {
    let converter: ValibotModule
    try {
      converter = (await importModule("@valibot/to-json-schema")) as ValibotModule
    } catch {
      return reject(
        '"@valibot/to-json-schema" is not installed in the project',
        "Install it (`bun add -D @valibot/to-json-schema`), or leave the vendor out of schemaSources.",
      )
    }
    const toJsonSchema = converter.toJsonSchema
    if (typeof toJsonSchema !== "function") {
      return reject('"@valibot/to-json-schema" has no toJsonSchema export')
    }
    try {
      // `typeMode` is left at valibot's default for the output side: valibot then refuses a
      // pipeline that has a transform, which is the fail-closed behavior. The input side stops
      // before the first transform, so it is exact and needs no default.
      const schema = toJsonSchema(value, {
        ...(ctx.io === "input" ? { typeMode: "input" } : {}),
        errorMode: "throw",
        overrideSchema: valibotNonFiniteGuard,
      }) as JsonSchema
      return { kind: "converted", schema, warnings: [] }
    } catch (err) {
      return reject(`@valibot/to-json-schema rejected the schema (${String(err)})`)
    }
  }

  return reject(`vendor "${std.vendor}" provides no JSON Schema converter`)
}
