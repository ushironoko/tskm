import type { JsonWorkerContext, JsonWorkerEntry } from "./jsonschema.ts"
import { schemaToJsonSchemaViaAdapter } from "./jsonschema-adapter.ts"
import { deriveTypeName } from "./naming.ts"
import { buildExportNames, runSchemaWorker } from "./worker-harness.ts"

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
  : { io: "output", allowedVendors: ["tskm", "zod", "valibot", "arktype"] }
const allowedVendors = new Set(context.allowedVendors)

// Built once per module on first extraction: schema object identity -> the same
// PascalCase name discovery derives, so a hoisted recursive `$defs` entry is named
// `Category` instead of `object`/`object_2`.
let exportNames: ReadonlyMap<object, string> | undefined

await runSchemaWorker<JsonWorkerEntry>(async (name, value, mod) => {
  exportNames ??= buildExportNames(mod, deriveTypeName)
  const outcome = await schemaToJsonSchemaViaAdapter(value, {
    io: context.io,
    allowedVendors,
    exportNames,
  })
  if (outcome.kind === "excluded") {
    // Marked, not dropped: the parent aggregates excluded vendors into one
    // diagnostic per (file, vendor). `skipped` keeps it out of the document.
    return { name, schema: {}, warnings: [], skipped: true, excludedVendor: outcome.vendor }
  }
  if (outcome.kind === "skipped") {
    return { name, schema: {}, warnings: [outcome.reason], skipped: true }
  }
  return { name, schema: outcome.schema, warnings: outcome.warnings }
})
