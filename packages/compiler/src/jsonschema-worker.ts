import { type JsonSchema, schemaToJsonSchema } from "./jsonschema.ts"
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
 * worker; this entry only supplies the per-schema extraction.
 */

interface SchemaEntry {
  readonly name: string
  readonly schema: JsonSchema
  readonly warnings: ReadonlyArray<string>
}

// Built once per module on first extraction: schema object identity -> the same
// PascalCase name discovery derives, so a hoisted recursive `$defs` entry is named
// `Category` instead of `object`/`object_2`.
let exportNames: ReadonlyMap<object, string> | undefined

await runSchemaWorker<SchemaEntry>((name, value, mod) => {
  exportNames ??= buildExportNames(mod, deriveTypeName)
  const { schema, warnings } = schemaToJsonSchema(value, { exportNames })
  return { name, schema, warnings }
})
