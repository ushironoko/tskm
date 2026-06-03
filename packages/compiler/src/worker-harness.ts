import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/**
 * Shared process-isolation harness for compiler passes that must EVALUATE the user's
 * schema module (JSON Schema extraction, structural recursive-type extraction).
 *
 * Importing a user module can boot DBs, hit the network, or hang, so it always runs
 * in a throwaway child process the parent can SIGKILL (`runWorker`), and the child
 * always reports through a temp-file envelope — never stdout, which the imported
 * module is free to pollute (and some runtimes' `console.log` bypasses stdout
 * patching). `runSchemaWorker` is the worker-side half of the protocol; worker
 * entries pass an `extract` for their per-schema payload and inherit the argv/guard/
 * error conventions. This module must stay dependency-free (node builtins only): the
 * worker entries import it, so pulling in `jsonschema.ts`/`structural-ts.ts` here
 * would create an import cycle.
 */

/** Every envelope carries an optional error; `runWorker` turns it into a diagnostic. */
export interface WorkerEnvelopeBase {
  readonly error?: string
}

/** The shared schema-worker envelope: per-export entries + the error channel. */
export interface SchemaWorkerEnvelope<TEntry> extends WorkerEnvelopeBase {
  readonly schemas?: ReadonlyArray<TEntry>
}

export interface RunWorkerOptions {
  /** Working directory for the child (the project root). */
  readonly root: string
  /**
   * Runtime used to execute the worker. Set to a TS-capable binary (bun/tsx) when
   * the schema modules are TypeScript and the host runtime cannot import `.ts`.
   */
  readonly execPath: string
  /** Hard timeout (ms); the child is SIGKILLed on overrun. */
  readonly timeoutMs: number
  /** Folded into the temp envelope filename, e.g. `"jsonschema"`. */
  readonly tag: string
  /** Extra argv entries appended after the envelope path (worker-specific protocol). */
  readonly extraArgs?: ReadonlyArray<string>
}

export type WorkerResult<TEnvelope extends WorkerEnvelopeBase> =
  | { readonly envelope: TEnvelope; readonly diagnostic?: undefined }
  | { readonly envelope?: undefined; readonly diagnostic: string }

/**
 * Spawns one worker run against one source module and returns either the parsed
 * envelope or a single diagnostic string. All four failure modes (spawn error,
 * non-zero exit, unreadable envelope, in-envelope error) collapse to `diagnostic`
 * so callers have exactly one failure branch; the temp envelope file is always
 * removed. `spawnSync` is intentional: it gives the timeout/kill semantics needed
 * with the simplest control flow, and lets the same harness serve the sync
 * (`generateFile`) and async (`generateJsonSchema`) callers.
 */
export function runWorker<TEnvelope extends WorkerEnvelopeBase>(
  workerAbs: string,
  sourceAbs: string,
  options: RunWorkerOptions,
): WorkerResult<TEnvelope> {
  const unique = process.hrtime.bigint().toString(36)
  const envelopeFile = join(tmpdir(), `tskm-${options.tag}-${process.pid}-${unique}.json`)
  try {
    const args = [workerAbs, sourceAbs, envelopeFile, ...(options.extraArgs ?? [])]
    const child = spawnSync(options.execPath, args, {
      cwd: options.root,
      timeout: options.timeoutMs,
      killSignal: "SIGKILL",
      encoding: "utf8",
      env: { ...process.env },
    })

    if (child.error) {
      return { diagnostic: `tskm: ${sourceAbs}: worker failed (${child.error.message}); skipped.` }
    }
    if (child.status !== 0) {
      return { diagnostic: `tskm: ${sourceAbs}: worker exited with code ${child.status}; skipped.` }
    }

    let envelope: TEnvelope
    try {
      envelope = JSON.parse(readFileSync(envelopeFile, "utf8")) as TEnvelope
    } catch {
      return { diagnostic: `tskm: ${sourceAbs}: could not read worker output; skipped.` }
    }
    if (envelope.error) {
      return { diagnostic: `tskm: ${sourceAbs}: ${envelope.error}; skipped.` }
    }
    return { envelope }
  } finally {
    rmSync(envelopeFile, { force: true })
  }
}

/**
 * Resolves a sibling worker entry by base name. In source it is `<base>.ts`; in the
 * published package it is bundled to `<base>.mjs`. Picking whichever exists lets the
 * same code path work from `src` (Bun/vitest) and from `dist`.
 */
export function resolveWorker(baseName: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const tsEntry = join(here, `${baseName}.ts`)
  const mjsEntry = join(here, `${baseName}.mjs`)
  return existsSync(mjsEntry) ? mjsEntry : tsEntry
}

/** A duck-typed view of a runtime tskm schema object (never `instanceof`). */
function isSchema(value: unknown): value is { readonly kind: "schema" } {
  return (
    value !== null && typeof value === "object" && (value as { kind?: unknown }).kind === "schema"
  )
}

/**
 * Builds the identity map from exported runtime schema objects to display names.
 * `rename` maps the export binding to the emitted name (the workers pass
 * `deriveTypeName` so the result matches discovery's `typeName` exactly). When two
 * exports alias the SAME object (`export const b = a`), the first export wins so the
 * name is stable regardless of re-exports.
 */
export function buildExportNames(
  mod: Record<string, unknown>,
  rename: (exportName: string) => string,
): ReadonlyMap<object, string> {
  const map = new Map<object, string>()
  for (const [name, value] of Object.entries(mod)) {
    if (isSchema(value) && !map.has(value)) {
      map.set(value, rename(name))
    }
  }
  return map
}

function emit(outFile: string, payload: unknown): void {
  writeFileSync(outFile, JSON.stringify(payload))
}

/**
 * The worker-side half of the protocol. A worker entry calls this with an `extract`
 * mapping one exported runtime schema to its envelope entry; everything else —
 * argv parsing (`argv[2]` source, `argv[3]` envelope file), the mandatory-envelope
 * and missing-source guards, the isolated dynamic import, export iteration, and the
 * exit-0 in-envelope error convention — is shared so the JSON Schema and structural
 * workers cannot drift apart.
 */
export async function runSchemaWorker<TEntry>(
  extract: (name: string, value: unknown, mod: Record<string, unknown>) => TEntry,
): Promise<void> {
  const outFile = process.argv[3]
  try {
    const sourceAbs = process.argv[2]
    // The envelope path is mandatory — stdout is never trusted (see module header).
    if (!outFile) {
      process.stderr.write("tskm: schema worker requires an envelope output path (argv[3]).\n")
      process.exitCode = 1
      return
    }
    if (!sourceAbs) {
      emit(outFile, { error: "no source path provided" })
      return
    }

    const mod = (await import(pathToFileURL(sourceAbs).href)) as Record<string, unknown>
    const schemas: TEntry[] = []
    for (const [name, value] of Object.entries(mod)) {
      if (!isSchema(value)) {
        continue
      }
      schemas.push(extract(name, value, mod))
    }
    emit(outFile, { schemas })
  } catch (err) {
    // Exit 0: the parent reads the envelope, not the exit code, to distinguish a
    // user-module error from a crashed worker.
    if (outFile) {
      emit(outFile, { error: String(err) })
    } else {
      process.stderr.write(`${String(err)}\n`)
      process.exitCode = 1
    }
  }
}
