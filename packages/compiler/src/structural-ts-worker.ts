import { deriveTypeName } from "./naming.ts"
import { type StructuralWorkerEntry, schemaToTypeString } from "./structural-ts.ts"
import { buildExportNames, runSchemaWorker } from "./worker-harness.ts"

/**
 * Isolated worker for structural recursive-type extraction.
 *
 * Spawned by `resolveRecursiveSchemas` only for source files whose discovery found a
 * `recursive(...)` schema — this is the single place the type-generation pipeline
 * EVALUATES a user module, so it runs in the same SIGKILL-guarded subprocess model as
 * the JSON Schema worker. The argv/envelope/error protocol lives in `runSchemaWorker`
 * (worker-harness.ts); this entry only supplies the per-schema extraction.
 *
 * Every exported schema gets an entry (`recursive: false` ones carry no body) so the
 * parent can distinguish "not recursive at runtime" from "export not found".
 */

// argv[4] (optional): JSON map of export name -> alias typeName, sent by the parent
// from DISCOVERY — the single naming source. An explicit `export type TreeNode =
// Infer<typeof nodeSchema>` alias would otherwise diverge from the derived name and
// the back-edge would reference an undeclared type.
const overridesRaw = process.argv[4]
const overrides: Record<string, string> = overridesRaw
  ? (JSON.parse(overridesRaw) as Record<string, string>)
  : {}
const nameFor = (exportName: string): string => overrides[exportName] ?? deriveTypeName(exportName)

// Built once per module on first extraction: schema object identity -> the exact
// alias string the sidecar declares, so back-edges and cross-references always
// match their declarations.
let typeNames: ReadonlyMap<object, string> | undefined

await runSchemaWorker<StructuralWorkerEntry>((name, value, mod) => {
  typeNames ??= buildExportNames(mod, nameFor)
  const typeName = nameFor(name)
  if ((value as { type?: unknown }).type !== "recursive") {
    return {
      name,
      typeName,
      recursive: false,
      typeString: "",
      bearsOpaque: false,
      opaquePaths: [],
      dataKeys: [],
      unsupported: false,
      warnings: [],
    }
  }
  const result = schemaToTypeString(value, { rootName: typeName, typeNames })
  return { name, typeName, recursive: true, ...result }
})
