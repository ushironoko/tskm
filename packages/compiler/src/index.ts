import { globSync, readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import {
  defineConfig,
  loadConfig,
  type ResolvedTskmConfig,
  resolveConfig,
  type TskmConfig,
  type TskmMode,
} from "./config.ts"
import { discoverSchemas } from "./discovery.ts"
import { emitSidecar } from "./emit.ts"
import { resolveSchemas } from "./resolve.ts"
import { createTsgoClient, type TsgoClient } from "./tsgo-client.ts"

export { deriveTypeName, discoverSchemas } from "./discovery.ts"
export { emitSidecar, reindentType, renderSidecar, sidecarPath } from "./emit.ts"
export { resolveSchemas } from "./resolve.ts"
export type { ResolvedType, TsgoClient } from "./tsgo-client.ts"
export {
  createTsgoClient,
  FAILURE_TYPE_FLAGS,
  resolveTsgoExecutable,
  TYPE_TO_STRING_FLAGS,
} from "./tsgo-client.ts"
export type { ResolvedTskmConfig, TskmConfig, TskmMode }
export { defineConfig, loadConfig, resolveConfig }

export interface GenerateOptions {
  /** Project root used to resolve the config and as the checker cwd. */
  readonly root?: string
  /** A pre-built config object; when omitted, the config file is loaded from `root`. */
  readonly config?: TskmConfig
  /** Pretty-print generated types (default true). */
  readonly pretty?: boolean
}

export interface GeneratedFile {
  readonly source: string
  readonly sidecar: string
  readonly typeNames: ReadonlyArray<string>
}

export interface GenerateResult {
  readonly files: ReadonlyArray<GeneratedFile>
  readonly diagnostics: ReadonlyArray<string>
}

function collectSources(config: ResolvedTskmConfig): ReadonlyArray<string> {
  const matches = new Set<string>()
  for (const pattern of config.include) {
    for (const match of globSync(pattern, { cwd: config.root })) {
      const abs = isAbsolute(match) ? match : resolve(config.root, match)
      // Never scan generated sidecars or our own query files.
      if (abs.endsWith(".gen.ts") || abs.endsWith(".tskm-query.ts")) {
        continue
      }
      matches.add(abs)
    }
  }
  return [...matches].sort()
}

function generateForFile(
  client: TsgoClient,
  sourceAbs: string,
  pretty: boolean,
): { file: GeneratedFile | null; diagnostics: ReadonlyArray<string> } {
  const sourceText = readFileSync(sourceAbs, "utf8")
  const discovery = discoverSchemas(sourceAbs, sourceText)
  if (discovery.schemas.length === 0) {
    return { file: null, diagnostics: discovery.diagnostics }
  }

  const { resolved, diagnostics } = resolveSchemas(client, sourceAbs, discovery.schemas)
  const allDiagnostics = [...discovery.diagnostics, ...diagnostics]
  if (resolved.length === 0) {
    return { file: null, diagnostics: allDiagnostics }
  }

  const emitted = emitSidecar(sourceAbs, resolved, { pretty })
  return {
    file: {
      source: sourceAbs,
      sidecar: emitted.sidecar,
      typeNames: resolved.map((r) => r.typeName),
    },
    diagnostics: allDiagnostics,
  }
}

/**
 * High-level pipeline: config -> discovery -> resolve -> emit across all included
 * files. Sidecar mode only for v1. A single tsgo client is reused for the whole run.
 */
export async function generate(options: GenerateOptions = {}): Promise<GenerateResult> {
  const root = resolve(options.root ?? process.cwd())
  const config = options.config ? resolveConfig(options.config, root) : await loadConfig(root)

  if (config.mode !== "sidecar") {
    throw new Error(`tskm: mode "${config.mode}" is not implemented yet (v1 supports "sidecar").`)
  }

  const sources = collectSources(config)
  const files: GeneratedFile[] = []
  const diagnostics: string[] = []

  if (sources.length === 0) {
    return { files, diagnostics: [`tskm: no source files matched ${config.include.join(", ")}`] }
  }

  const client = createTsgoClient({
    cwd: config.root,
    tsconfigPath: config.tsconfig,
    executable: config.executable,
  })

  try {
    for (const sourceAbs of sources) {
      const result = generateForFile(client, sourceAbs, options.pretty ?? true)
      diagnostics.push(...result.diagnostics)
      if (result.file) {
        files.push(result.file)
      }
    }
  } finally {
    client.close()
  }

  // Re-anchor diagnostics' absolute paths to be root-relative for readability.
  const readable = diagnostics.map((d) => d.replaceAll(`${config.root}/`, ""))
  return { files, diagnostics: readable }
}
