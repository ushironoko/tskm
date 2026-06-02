import { existsSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export type TskmMode = "sidecar" | "inplace"

export interface TskmConfig {
  /** Output strategy. Only "sidecar" is implemented in v1. */
  readonly mode?: TskmMode
  /** Glob patterns (relative to the project root) of source files to scan. */
  readonly include?: ReadonlyArray<string>
  /** Path to the tsconfig that defines the project for the checker. */
  readonly tsconfig?: string
  /** Explicit override for the tsgo binary. */
  readonly executable?: string
}

export interface ResolvedTskmConfig {
  readonly mode: TskmMode
  readonly include: ReadonlyArray<string>
  readonly tsconfig: string
  readonly executable: string | undefined
  /** The directory the config was resolved against (the checker cwd). */
  readonly root: string
}

const DEFAULT_INCLUDE = ["src/**/*.ts"] as const

/** Identity helper for authoring `tskm.config.ts` with full type inference. */
export function defineConfig(config: TskmConfig): TskmConfig {
  return config
}

const CONFIG_FILENAMES = ["tskm.config.ts", "tskm.config.mjs", "tskm.config.js"] as const

/** Resolves the raw config to absolute, defaulted values. */
export function resolveConfig(config: TskmConfig, root: string): ResolvedTskmConfig {
  const absRoot = resolve(root)
  const tsconfig = config.tsconfig
    ? isAbsolute(config.tsconfig)
      ? config.tsconfig
      : join(absRoot, config.tsconfig)
    : join(absRoot, "tsconfig.json")
  return {
    mode: config.mode ?? "sidecar",
    include: config.include ?? DEFAULT_INCLUDE,
    tsconfig,
    executable: config.executable,
    root: absRoot,
  }
}

/**
 * Loads `tskm.config.{ts,mjs,js}` from `root` via dynamic import. The bare object
 * form (no config file) falls back to defaults. The `ts` form relies on the host
 * runtime being able to import TypeScript (Bun/Node with a loader); callers that
 * cannot may pass a config object directly to {@link resolveConfig}.
 */
export async function loadConfig(root: string): Promise<ResolvedTskmConfig> {
  const absRoot = resolve(root)
  for (const name of CONFIG_FILENAMES) {
    const candidate = join(absRoot, name)
    if (!existsSync(candidate)) {
      continue
    }
    const mod = (await import(pathToFileURL(candidate).href)) as {
      default?: TskmConfig
      config?: TskmConfig
    }
    const raw = mod.default ?? mod.config
    if (!raw) {
      throw new Error(`tskm: ${name} has no default export.`)
    }
    return resolveConfig(raw, absRoot)
  }
  return resolveConfig({}, absRoot)
}
