import { deriveTypeName } from "./naming.ts"
import { type StructuralWorkerEntry, schemaToTypeString } from "./structural-ts.ts"
import { buildTargetIdentityMap, isTskmWalkable, runSchemaWorker } from "./worker-harness.ts"

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

// argv[4]: ordered JSON `[exportName, typeName]` pairs for the file's DECLARED
// structural targets — discovery's typeName is the single naming source, so an
// alias-renamed target (`export type TreeNode = Infer<typeof nodeSchema>`) emits
// back-edges that exactly match the declared alias. The identity map is seeded from
// these pairs ONLY (target-driven): re-exported or helper schemas never enter it,
// so the walker can never emit an alias name this sidecar does not declare.
const pairsRaw = process.argv[4]
const pairs: ReadonlyArray<readonly [string, string]> = pairsRaw
  ? (JSON.parse(pairsRaw) as ReadonlyArray<readonly [string, string]>)
  : []
const overrides = new Map(pairs)
const nameFor = (exportName: string): string =>
  overrides.get(exportName) ?? deriveTypeName(exportName)

// Built once per module on first extraction: schema object identity -> the exact
// alias string the sidecar declares, so back-edges and cross-references always
// match their declarations.
let typeNames: ReadonlyMap<object, string> | undefined

await runSchemaWorker<StructuralWorkerEntry>((name, value, mod) => {
  typeNames ??= buildTargetIdentityMap(mod, pairs)
  const typeName = nameFor(name)
  // `recursive` means "a tskm recursive() root" — the runtime authority for routing,
  // independent of how `recursive` was imported (direct or via a re-export hub). The
  // vendor gate is part of that judgement, not just the walk gate: a foreign value
  // that merely carries `type: "recursive"` (a non-tskm vendor) reports recursive=false
  // so the parent skips it with a diagnostic, never emitting an empty/invalid alias.
  const recursive = (value as { type?: unknown }).type === "recursive" && isTskmWalkable(value)
  // Only declared targets are walked: the parent never consumes non-target entries,
  // and the walk contract requires the root to be IN the identity map (which only
  // targets are). A re-exported tskm recursive gets a stub here (recursive=true, no
  // body) and is simply never consumed.
  if (!recursive || !overrides.has(name)) {
    return {
      name,
      typeName,
      recursive,
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
