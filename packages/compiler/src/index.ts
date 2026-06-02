import { resolve } from "node:path"
import {
  defineConfig,
  loadConfig,
  type ResolvedTskmConfig,
  resolveConfig,
  type TskmConfig,
  type TskmJsonSchemaOptions,
  type TskmMode,
  type TskmWatchOptions,
} from "./config.ts"
import { createSession, type GenerateResult } from "./session.ts"

export { type DiscoveredSchema, deriveTypeName, discoverSchemas } from "./discovery.ts"
export { type EmitResult, emitSidecar, reindentType, renderSidecar, sidecarPath } from "./emit.ts"
export {
  collectInplaceTargets,
  type EmitInplaceOptions,
  emitInplace,
  type InplaceEmitResult,
} from "./inplace.ts"
export {
  generateJsonSchema,
  type JsonSchema,
  type JsonSchemaOptions,
  type JsonSchemaResult,
  schemaToJsonSchema,
} from "./jsonschema.ts"
export { type ResolvedSchema, type ResolveResult, resolveSchemas } from "./resolve.ts"
export {
  createSession,
  GENERATOR_VERSION,
  type GeneratedFile,
  type GenerateResult,
  type PerFileResult,
  type TskmSession,
} from "./session.ts"
export type { ResolvedType, TsgoClient } from "./tsgo-client.ts"
export {
  createTsgoClient,
  FAILURE_TYPE_FLAGS,
  resolveTsgoExecutable,
  TYPE_TO_STRING_FLAGS,
} from "./tsgo-client.ts"
export { type WatchController, type WatchOptions, watch } from "./watch.ts"
export type { ResolvedTskmConfig, TskmConfig, TskmJsonSchemaOptions, TskmMode, TskmWatchOptions }
export { defineConfig, loadConfig, resolveConfig }

export interface GenerateOptions {
  /** Project root used to resolve the config and as the checker cwd. */
  readonly root?: string
  /** A pre-built config object; when omitted, the config file is loaded from `root`. */
  readonly config?: TskmConfig
  /** Overrides the resolved config's emit mode (e.g. from a CLI `--mode` flag). */
  readonly mode?: TskmMode
  /** Pretty-print generated types (default true). */
  readonly pretty?: boolean
}

/**
 * High-level one-shot pipeline: config -> discovery -> resolve -> emit across all
 * included files, using a single reused {@link createSession}. Supports both
 * `sidecar` (default) and experimental `inplace` modes.
 */
export async function generate(options: GenerateOptions = {}): Promise<GenerateResult> {
  const root = resolve(options.root ?? process.cwd())
  const base: ResolvedTskmConfig = options.config
    ? resolveConfig(options.config, root)
    : await loadConfig(root)
  const config: ResolvedTskmConfig = options.mode ? { ...base, mode: options.mode } : base

  const session = createSession(config)
  try {
    return session.generateAll(options.pretty ?? true)
  } finally {
    session.close()
  }
}
