import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { type JsonSchema, schemaToJsonSchema } from "./jsonschema.ts"

/**
 * Isolated worker for JSON Schema extraction.
 *
 * Spawned by `generateJsonSchema` as a separate process so that importing the
 * user's schema module (which may, as a side effect, open DB connections, read env,
 * or hit the network) cannot corrupt or hang the compiler. The parent enforces a
 * timeout and kills the child if it overruns.
 *
 * Protocol: `process.argv[2]` is the source module's absolute path and `argv[3]` is a
 * file the worker writes its JSON envelope to. A FILE (not stdout) is used because the
 * imported module can freely write to stdout — and some runtimes' `console.log` (e.g.
 * Bun's) bypasses a monkey-patched `process.stdout.write`, so stdout cannot be trusted.
 */

interface SchemaEntry {
  readonly name: string
  readonly schema: JsonSchema
  readonly warnings: ReadonlyArray<string>
}

function isSchema(value: unknown): value is { kind: "schema" } {
  return (
    value !== null && typeof value === "object" && (value as { kind?: unknown }).kind === "schema"
  )
}

function emit(outFile: string, payload: unknown): void {
  writeFileSync(outFile, JSON.stringify(payload))
}

async function main(): Promise<void> {
  const sourceAbs = process.argv[2]
  const outFile = process.argv[3]
  // The envelope path is mandatory — stdout is never trusted (see header).
  if (!outFile) {
    process.stderr.write("tskm: jsonschema-worker requires an envelope output path (argv[3]).\n")
    process.exitCode = 1
    return
  }
  if (!sourceAbs) {
    emit(outFile, { error: "no source path provided" })
    return
  }

  const mod = (await import(pathToFileURL(sourceAbs).href)) as Record<string, unknown>
  const schemas: SchemaEntry[] = []
  for (const [name, value] of Object.entries(mod)) {
    if (!isSchema(value)) {
      continue
    }
    const { schema, warnings } = schemaToJsonSchema(value)
    schemas.push({ name, schema, warnings })
  }
  emit(outFile, { schemas })
}

main().catch((err) => {
  // Exit 0: the parent reads the envelope, not the exit code, to distinguish a
  // user-module error from a crashed worker.
  const outFile = process.argv[3]
  if (outFile) {
    emit(outFile, { error: String(err) })
  } else {
    process.stderr.write(`${String(err)}\n`)
    process.exitCode = 1
  }
})
