import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { CorsaApiClient } from "@corsa-bind/napi"

/**
 * typeToString flags: NoTruncation | UseStructuralFallback | InTypeAlias | NoTypeReduction.
 * Empirically required for full, non-truncated expansion of anonymous inferred types.
 * flag=0 truncates around ~259 chars with `...N more...`.
 */
export const TYPE_TO_STRING_FLAGS = 545259529

/**
 * Type flags that signal a failed resolution: Any (1) | Unknown (2) | Never (262144).
 * A schema with a type error resolves to `any` rather than throwing, so callers must
 * mask against this to avoid overwriting good output with garbage (R6).
 */
export const FAILURE_TYPE_FLAGS = 1 | 2 | 262144

export interface ResolvedType {
  readonly flags: number
  readonly text: string
}

export interface TsgoClient {
  /** Registers a freshly written file with the open project. */
  readonly updateFile: (absPath: string, kind: "created" | "changed" | "deleted") => void
  /** Resolves the checker type at a position, then renders it fully expanded. */
  readonly resolveTypeAt: (queryFileAbs: string, position: number) => ResolvedType | null
  readonly close: () => void
}

interface SnapshotRecord {
  readonly snapshot: string
  readonly projects: ReadonlyArray<{ readonly id: string }>
}

/**
 * Resolves the tsgo binary via a two-step require chain: first the meta-package
 * `@typescript/native-preview`, then the platform-specific package next to it.
 * Resolving the platform package directly from this module would fail because it
 * is an optional dependency hoisted under the meta-package.
 */
export function resolveTsgoExecutable(override?: string): string {
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`tskm: configured tsgo executable not found: ${override}`)
    }
    return override
  }
  const require = createRequire(import.meta.url)
  const metaPkg = require.resolve("@typescript/native-preview/package.json")
  const metaRequire = createRequire(metaPkg)
  const platPkg = metaRequire.resolve(
    `@typescript/native-preview-${process.platform}-${process.arch}/package.json`,
  )
  const exe = join(dirname(platPkg), "lib", "tsgo")
  if (!existsSync(exe)) {
    throw new Error(`tskm: tsgo binary not found at ${exe}`)
  }
  return exe
}

export interface CreateTsgoClientOptions {
  readonly cwd: string
  readonly tsconfigPath: string
  readonly executable?: string
}

/**
 * Spawns and initializes a tsgo (Corsa) client bound to a single open project.
 *
 * `openProject` is called exactly once: repeating it stale-caches the initial file
 * contents and never reloads them. Every later file write must flow through
 * `updateFile` (fileChanges), never another `openProject`. `overlayChanges`
 * (in-memory virtual documents) is unsupported by native-preview, so callers write
 * real query files to disk.
 */
export function createTsgoClient(options: CreateTsgoClientOptions): TsgoClient {
  const executable = resolveTsgoExecutable(options.executable)
  const client = CorsaApiClient.spawn({
    executable,
    cwd: options.cwd,
    mode: "msgpack",
  })
  client.initialize()

  let project = ""
  const openOnce = (): void => {
    const snap = client.updateSnapshot({ openProject: options.tsconfigPath }) as SnapshotRecord
    const first = snap.projects[0]
    if (!first) {
      throw new Error(`tskm: tsconfig opened no projects: ${options.tsconfigPath}`)
    }
    project = first.id
  }
  openOnce()

  const updateFile: TsgoClient["updateFile"] = (absPath, kind) => {
    const fileChanges = { [kind]: [absPath] }
    const snap = client.updateSnapshot({ fileChanges }) as SnapshotRecord
    const first = snap.projects[0]
    if (first) {
      project = first.id
    }
    // Snapshots are short-lived handles; resolveTypeAt opens its own.
    client.releaseHandle(snap.snapshot)
  }

  const resolveTypeAt: TsgoClient["resolveTypeAt"] = (queryFileAbs, position) => {
    // Take a no-op snapshot to obtain a fresh handle for the current file state.
    const snap = client.updateSnapshot({ fileChanges: {} }) as SnapshotRecord
    const first = snap.projects[0]
    if (first) {
      project = first.id
    }
    try {
      const handle = client.getTypeAtPosition(snap.snapshot, project, queryFileAbs, position) as
        | { id: string; flags: number }
        | null
        | undefined
      if (!handle) {
        return null
      }
      const text = client.typeToString(
        snap.snapshot,
        project,
        handle.id,
        undefined,
        TYPE_TO_STRING_FLAGS,
      )
      return { flags: handle.flags, text }
    } finally {
      client.releaseHandle(snap.snapshot)
    }
  }

  const close: TsgoClient["close"] = () => {
    client.close()
  }

  // Capability probe: resolve the intrinsic `string` type and render it. This asserts
  // the spawn/initialize/openProject/checker/typeToString pipeline is live before any
  // real work, without needing a disk file (which would have to satisfy the tsconfig
  // include globs to be visible).
  const probe = (): void => {
    const snap = client.updateSnapshot({ fileChanges: {} }) as SnapshotRecord
    try {
      const handle = client.getStringType(snap.snapshot, project) as
        | { id: string; flags: number }
        | null
        | undefined
      if (!handle) {
        throw new Error("tskm: tsgo capability probe failed: getStringType returned no type.")
      }
      const text = client.typeToString(snap.snapshot, project, handle.id, undefined, 0)
      if (handle.flags & FAILURE_TYPE_FLAGS || text !== "string") {
        throw new Error(
          `tskm: tsgo capability probe failed: expected "string" (got "${text}", flags=${handle.flags}).`,
        )
      }
    } finally {
      client.releaseHandle(snap.snapshot)
    }
  }
  probe()

  return { updateFile, resolveTypeAt, close }
}
