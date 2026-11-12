import {
  buildStaticJsonSchemaDocs,
  type JsonWorkerContext,
  type JsonWorkerEntry,
  type StaticJsonSchemaConverters,
} from "./jsonschema.ts"
import { schemaToJsonSchemaViaAdapter } from "./jsonschema-adapter.ts"
import { deriveTypeName } from "./naming.ts"
import { buildExportNames, isTskmWalkable, runSchemaWorker } from "./worker-harness.ts"

/**
 * Isolated worker for JSON Schema extraction.
 *
 * Spawned by `generateJsonSchema` as a separate process so that importing the
 * user's schema module (which may, as a side effect, open DB connections, read env,
 * or hit the network) cannot corrupt or hang the compiler. The parent enforces a
 * timeout and kills the child if it overruns. The argv/envelope/error protocol
 * lives in `runSchemaWorker` (worker-harness.ts), shared with the structural-ts
 * worker; this entry only supplies the per-schema extraction — conversion itself
 * is the adapter's vendor dispatch (tskm walker / spec 1.1 / zod / valibot).
 */

// argv[4]: JSON-encoded routing context from the parent (io side + the vendor
// allow-list config implies). Absent only in legacy direct invocations.
const contextRaw = process.argv[4]
const context: JsonWorkerContext = contextRaw
  ? (JSON.parse(contextRaw) as JsonWorkerContext)
  : { io: "output", allowedVendors: ["tskm", "zod", "valibot", "arktype"], approximate: [] }
const allowedVendors = new Set(context.allowedVendors)

/**
 * The runtime walker lives in `@tskm/core`. The published worker resolves that package.
 * A source checkout whose `dist` is not built yet falls back to the sibling package
 * source. Either way the static path calls the same functions `withJsonSchema` calls.
 */
function asConverters(loaded: {
  convertToJsonSchema?: unknown
  retargetJsonSchema?: unknown
}): StaticJsonSchemaConverters | undefined {
  const convert = loaded.convertToJsonSchema
  const retarget = loaded.retargetJsonSchema
  if (typeof convert !== "function" || typeof retarget !== "function") {
    return undefined
  }
  return {
    convert: convert as StaticJsonSchemaConverters["convert"],
    retarget: retarget as StaticJsonSchemaConverters["retarget"],
  }
}

async function loadStaticConverters(): Promise<StaticJsonSchemaConverters> {
  const specifiers = [
    "@tskm/core/json-schema",
    new URL("../../tskm/src/json-schema.ts", import.meta.url).href,
  ]
  for (const specifier of specifiers) {
    try {
      const converters = asConverters(await loadConverterModule(specifier))
      if (converters !== undefined) {
        return converters
      }
    } catch {
      // Try the next specifier. A published install resolves the package; a source
      // checkout without dist falls through to the sibling package.
    }
  }
  throw new Error(
    'static JSON Schema needs convertToJsonSchema and retargetJsonSchema from "@tskm/core/json-schema". Install @tskm/core.',
  )
}

async function loadConverterModule(specifier: string): Promise<{
  convertToJsonSchema?: unknown
  retargetJsonSchema?: unknown
}> {
  return (await import(specifier)) as {
    convertToJsonSchema?: unknown
    retargetJsonSchema?: unknown
  }
}

let staticConverters: Promise<StaticJsonSchemaConverters> | undefined

// Built once per module on first extraction: schema object identity -> the same
// PascalCase name discovery derives, so a hoisted recursive `$defs` entry is named
// `Category` instead of `object`/`object_2`.
let exportNames: ReadonlyMap<object, string> | undefined

async function staticFieldsFor(
  name: string,
  value: unknown,
): Promise<Pick<JsonWorkerEntry, "staticDocs" | "staticErrors" | "staticWarnings">> {
  if (context.staticEmit !== true || !isTskmWalkable(value)) {
    return {}
  }
  staticConverters ??= loadStaticConverters()
  const built = buildStaticJsonSchemaDocs(value, {
    approximate: context.approximate,
    rootName: name,
    exportNames,
    converters: await staticConverters,
  })
  return {
    staticDocs: built.docs,
    staticErrors: built.errors,
    staticWarnings: built.warnings,
  }
}

// argv[2] is the schema module. Converter packages resolve from its directory (see the adapter).
const sourceAbs = process.argv[2]

await runSchemaWorker<JsonWorkerEntry>(async (name, value, mod) => {
  exportNames ??= buildExportNames(mod, deriveTypeName)
  const staticFields = await staticFieldsFor(name, value)
  const outcome = await schemaToJsonSchemaViaAdapter(value, {
    io: context.io,
    allowedVendors,
    exportNames,
    rootName: name,
    approximate: context.approximate,
    importFrom: sourceAbs,
  })
  if (outcome.kind === "excluded") {
    // Marked, not dropped: the parent aggregates excluded vendors into one
    // diagnostic per (file, vendor). `skipped` keeps it out of the document.
    return {
      name,
      schema: {},
      warnings: [],
      skipped: true,
      excludedVendor: outcome.vendor,
      ...staticFields,
    }
  }
  if (outcome.kind === "rejected") {
    // Fail closed: the parent writes nothing for this file. Static documents, when
    // requested, are still attached so sidecar generation can use them on its own.
    return { name, schema: {}, warnings: [], errors: outcome.errors, ...staticFields }
  }
  return { name, schema: outcome.schema, warnings: outcome.warnings, ...staticFields }
})
