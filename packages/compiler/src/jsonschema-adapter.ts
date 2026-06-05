import { type JsonSchema, schemaToJsonSchema } from "./jsonschema.ts"
import { isTskmWalkable, readStandard } from "./worker-harness.ts"

/**
 * Vendor dispatch for JSON Schema conversion. The tskm walker only understands
 * tskm's internal object conventions, so external Standard Schemas are routed
 * to their own converters instead (codex review: this is an adapter layer with
 * per-provider errors, never a provider swap inside the walker):
 *
 *   1. tskm-walkable        -> the native duck-typed walker (jsonschema.ts)
 *   2. spec 1.1 `~standard.jsonSchema` (arktype) -> its io-specific method
 *   3. vendor "zod"         -> `z.toJSONSchema` (zod core, user's node_modules)
 *   4. vendor "valibot"     -> `@valibot/to-json-schema` (extra package)
 *   5. anything else        -> skipped with a reason
 *
 * Every conversion failure (unrepresentable type, missing package) collapses to
 * a `skipped` outcome — one schema's failure never aborts the file, and nothing
 * vacuous is written for it. Runs inside the isolated schema worker, so the
 * dynamic imports resolve from the USER's project.
 */

/** The draft every converter is asked for (the tskm walker's native output). */
export const JSON_SCHEMA_TARGET = "draft-2020-12"

export interface AdapterContext {
  /** Which side to render (zod honors it; others may not distinguish). */
  readonly io: "input" | "output"
  /** Vendors enabled by config (`schemaSources`-derived); tskm is always present. */
  readonly allowedVendors: ReadonlySet<string>
  /** Identity map for the tskm walker's `$defs` naming (see jsonschema.ts). */
  readonly exportNames?: ReadonlyMap<object, string> | undefined
  /**
   * DI seam for the converter imports (defaults to the real dynamic `import`).
   * Exists so the missing-package branches are testable with the packages
   * installed — never set in production paths.
   */
  readonly importModule?: (specifier: string) => Promise<unknown>
}

export type AdapterOutcome =
  | {
      readonly kind: "converted"
      readonly schema: JsonSchema
      readonly warnings: ReadonlyArray<string>
    }
  /** Convertible in principle, but this schema failed — surface the reason. */
  | { readonly kind: "skipped"; readonly reason: string }
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
  readonly input?: (options: { target: string }) => unknown
  readonly output?: (options: { target: string }) => unknown
}

export async function schemaToJsonSchemaViaAdapter(
  value: unknown,
  ctx: AdapterContext,
): Promise<AdapterOutcome> {
  // tskm first: walkable schemas (vendor "tskm" or the legacy kind form) use
  // the native walker, warnings and all.
  if (isTskmWalkable(value)) {
    const { schema, warnings } = schemaToJsonSchema(value, { exportNames: ctx.exportNames })
    return { kind: "converted", schema, warnings }
  }

  const std = readStandard(value)
  if (!std) {
    return { kind: "skipped", reason: "not a Standard Schema value" }
  }
  if (!ctx.allowedVendors.has(std.vendor)) {
    return { kind: "excluded", vendor: std.vendor }
  }

  // Spec 1.1 native converter (`~standard.jsonSchema.output({ target })`,
  // arktype ships it): the vendor's own conversion is the most faithful.
  const marker = (value as Record<string, unknown>)["~standard"] as Record<string, unknown>
  const native = marker.jsonSchema as NativeJsonSchemaConverter | undefined
  const method = native?.[ctx.io]
  if (typeof method === "function") {
    try {
      const schema = method.call(native, { target: JSON_SCHEMA_TARGET }) as JsonSchema
      return { kind: "converted", schema, warnings: [] }
    } catch (err) {
      return {
        kind: "skipped",
        reason: `the ${std.vendor} JSON Schema converter rejected the schema (${String(err)})`,
      }
    }
  }

  const importModule = ctx.importModule ?? ((specifier: string) => import(specifier))

  if (std.vendor === "zod") {
    let toJSONSchema: typeof import("zod")["z"]["toJSONSchema"]
    try {
      ;({
        z: { toJSONSchema },
      } = (await importModule("zod")) as typeof import("zod"))
    } catch {
      return { kind: "skipped", reason: 'could not import "zod" from the project' }
    }
    try {
      const schema = toJSONSchema(value as Parameters<typeof toJSONSchema>[0], {
        io: ctx.io,
        unrepresentable: "throw",
      }) as JsonSchema
      return { kind: "converted", schema, warnings: [] }
    } catch (err) {
      return { kind: "skipped", reason: `z.toJSONSchema rejected the schema (${String(err)})` }
    }
  }

  if (std.vendor === "valibot") {
    let toJsonSchema: typeof import("@valibot/to-json-schema")["toJsonSchema"]
    try {
      ;({ toJsonSchema } = (await importModule(
        "@valibot/to-json-schema",
      )) as typeof import("@valibot/to-json-schema"))
    } catch {
      return {
        kind: "skipped",
        reason:
          'converting valibot schemas requires "@valibot/to-json-schema" in your project (`bun add -D @valibot/to-json-schema`)',
      }
    }
    try {
      const schema = toJsonSchema(value as Parameters<typeof toJsonSchema>[0]) as JsonSchema
      return { kind: "converted", schema, warnings: [] }
    } catch (err) {
      return {
        kind: "skipped",
        reason: `@valibot/to-json-schema rejected the schema (${String(err)})`,
      }
    }
  }

  return { kind: "skipped", reason: `vendor "${std.vendor}" provides no JSON Schema converter` }
}
