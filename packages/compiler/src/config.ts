import { existsSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export type TskmMode = "sidecar" | "inplace"

/** Options for the experimental JSON Schema output (`tskm json-schema`). */
export interface TskmJsonSchemaOptions {
  /**
   * Directory (relative to the project root) the `*.schema.json` files are
   * written to. When omitted, each JSON Schema is written next to its source as
   * `<base>.schema.json`.
   */
  readonly outDir?: string
  /**
   * Which side of the schema to render: `output` (default, the post-transform
   * type, matching the type generator's `InferOutput` semantics) or `input`.
   * Honored where the delegated converter supports it (zod); ignored otherwise.
   */
  readonly io?: "input" | "output"
}

/** Options for `tskm watch`. */
export interface TskmWatchOptions {
  /** Debounce window (ms) for coalescing bursts of file-system events. */
  readonly debounceMs?: number
}

/**
 * Options for the isolated schema workers (structural recursive types; also the
 * defaults for `tskm json-schema`). Recursive schemas are the only type-gen path
 * that EVALUATES the user module, so it runs in a SIGKILL-guarded subprocess.
 */
export interface TskmWorkerOptions {
  /**
   * Runtime used to execute the worker (defaults to `process.execPath`). Point it
   * at a TS-capable binary (bun/tsx) when the schema modules are TypeScript and the
   * host runtime cannot import `.ts`.
   */
  readonly execPath?: string
  /** Hard timeout (ms) per worker run. */
  readonly timeoutMs?: number
}

export interface TskmConfig {
  /** Output strategy: `sidecar` (default) writes `*.gen.ts`; `inplace` rewrites markers in place. */
  readonly mode?: TskmMode
  /** Glob patterns (relative to the project root) of source files to scan. */
  readonly include?: ReadonlyArray<string>
  /** Path to the tsconfig that defines the project for the checker. */
  readonly tsconfig?: string
  /** Explicit override for the tsgo binary. */
  readonly executable?: string
  /** Experimental JSON Schema output options. */
  readonly jsonSchema?: TskmJsonSchemaOptions
  /** Watch-mode options. */
  readonly watch?: TskmWatchOptions
  /** Isolated schema-worker options (recursive structural types). */
  readonly worker?: TskmWorkerOptions
  /**
   * Module names whose exports are treated as Standard Schema sources: values
   * built from these imports become discovery candidates, confirmed by the
   * checker (`~standard` conditional probe). `@tskm/core` is always included
   * implicitly; an empty array means tskm schemas only (external opt-out).
   * A source also matches its subpaths (`zod` covers `zod/v4`, `zod/mini`).
   */
  readonly schemaSources?: ReadonlyArray<string>
}

export interface ResolvedJsonSchemaOptions {
  readonly outDir: string | undefined
  readonly io: "input" | "output"
}

export interface ResolvedWatchOptions {
  readonly debounceMs: number
}

export interface ResolvedWorkerOptions {
  readonly execPath: string | undefined
  readonly timeoutMs: number
}

export interface ResolvedTskmConfig {
  readonly mode: TskmMode
  readonly include: ReadonlyArray<string>
  readonly tsconfig: string
  readonly executable: string | undefined
  readonly jsonSchema: ResolvedJsonSchemaOptions
  readonly watch: ResolvedWatchOptions
  readonly worker: ResolvedWorkerOptions
  /** Schema source modules, `@tskm/core` always first (see {@link TskmConfig}). */
  readonly schemaSources: ReadonlyArray<string>
  /** The directory the config was resolved against (the checker cwd). */
  readonly root: string
}

const DEFAULT_INCLUDE = ["src/**/*.ts"] as const
const DEFAULT_DEBOUNCE_MS = 50
const DEFAULT_WORKER_TIMEOUT_MS = 5000

/** The runtime package that is always an implicit (and non-removable) schema source. */
export const RUNTIME_SCHEMA_SOURCE = "@tskm/core"
const DEFAULT_SCHEMA_SOURCES = ["zod", "valibot", "arktype"] as const

/**
 * True when `module` (an import specifier) belongs to schema source `source`:
 * an exact match or a subpath of it (`zod` matches `zod/v4`, not `zod-extra`).
 */
export function matchesSchemaSource(module: string, source: string): boolean {
  return module === source || module.startsWith(`${source}/`)
}

/**
 * The Standard Schema vendor identity of a configured source: its package
 * root (`zod/v4` -> `zod`, `@scope/name/sub` -> `@scope/name`). The root —
 * never the verbatim source string — is what runtime vendor checks compare
 * against: zod/valibot/arktype all publish `~standard.vendor` strings equal
 * to their package root.
 */
export function vendorName(source: string): string {
  const parts = source.split("/")
  return parts.slice(0, source.startsWith("@") ? 2 : 1).join("/")
}

/**
 * The JSON Schema vendor allow-list a resolved `schemaSources` implies: each
 * source maps to its vendor root via {@link vendorName} (deduped — `zod` and
 * `zod/v4` are one vendor); `@tskm/core` maps to "tskm".
 */
export function vendorAllowList(schemaSources: ReadonlyArray<string>): ReadonlyArray<string> {
  return [
    "tskm",
    ...new Set(schemaSources.filter((s) => s !== RUNTIME_SCHEMA_SOURCE).map(vendorName)),
  ]
}

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
    jsonSchema: { outDir: config.jsonSchema?.outDir, io: config.jsonSchema?.io ?? "output" },
    watch: { debounceMs: config.watch?.debounceMs ?? DEFAULT_DEBOUNCE_MS },
    worker: {
      execPath: config.worker?.execPath,
      timeoutMs: config.worker?.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS,
    },
    schemaSources: [
      RUNTIME_SCHEMA_SOURCE,
      ...new Set(
        (config.schemaSources ?? DEFAULT_SCHEMA_SOURCES).filter((s) => s !== RUNTIME_SCHEMA_SOURCE),
      ),
    ],
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
