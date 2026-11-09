import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { withBunSyncChannelFds } from "./bun-sync-fds.ts"

/**
 * typeToString flags: NoTruncation | UseStructuralFallback | InTypeAlias | NoTypeReduction.
 * Empirically required for full, non-truncated expansion of anonymous inferred types.
 * flag=0 truncates around ~259 chars with `...N more...`. The numeric value is the
 * official TypeFormatFlags mask (1 | 8 | 8388608 | 536870912).
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

export interface FileDiagnostic {
  readonly code: number
  readonly fileName: string
  /** The checker's message text (absent on synthetic fail-closed entries). */
  readonly text?: string
}

export interface TsgoClient {
  /** Registers a freshly written file with the open project. */
  readonly updateFile: (absPath: string, kind: "created" | "changed" | "deleted") => void
  /**
   * Batched {@link updateFile}: applies all of `created`/`changed`/`deleted` in ONE
   * snapshot, so registering N query files costs one project re-sync instead of N. The
   * file-set change (created/deleted) is what the checker charges for, so batching it is the
   * dominant codegen win on a full run.
   */
  readonly updateFiles: (summary: {
    readonly created?: ReadonlyArray<string>
    readonly changed?: ReadonlyArray<string>
    readonly deleted?: ReadonlyArray<string>
  }) => void
  /**
   * True when query documents can be registered in memory. The official sync API always
   * can, via a `createFileSystemLayer` overlay, so this is true for every client this
   * module constructs. Callers that pass a stub may still set it false to exercise the
   * on-disk query-file fallback.
   */
  readonly supportsOverlay: boolean
  /**
   * Registers in-memory overlay documents (no disk write), keyed by an absolute path used
   * as the document identifier. Only valid when {@link supportsOverlay} is true.
   */
  readonly applyOverlay: (
    entries: ReadonlyArray<{ readonly document: string; readonly text: string }>,
  ) => void
  /** Removes in-memory overlay documents previously registered via {@link applyOverlay}. */
  readonly clearOverlay: (documents: ReadonlyArray<string>) => void
  /**
   * Runs `fn` under the current snapshot, passing it a `resolveAt` that reuses that
   * snapshot for every query. The file state does not change inside `fn`, so one
   * snapshot serves every marker. The snapshot stays live until the next update.
   */
  readonly withSnapshot: <T>(
    fn: (resolveAt: (queryFileAbs: string, position: number) => ResolvedType | null) => T,
  ) => T
  /** Resolves the checker type at a position, then renders it fully expanded. */
  readonly resolveTypeAt: (queryFileAbs: string, position: number) => ResolvedType | null
  /**
   * Semantic diagnostics scoped to one file — the fixpoint oracle's measuring
   * instrument. If the checker call throws or returns a non-array, this returns
   * a synthetic diagnostic so the caller fails CLOSED (skeleton kept).
   */
  readonly getDiagnostics: (probeFileAbs: string) => ReadonlyArray<FileDiagnostic>
  readonly close: () => void
}

interface CheckerDiagnostic {
  readonly code?: number
  readonly fileName?: string
  readonly text?: string
}

function toSlashes(path: string): string {
  return path.replace(/\\/g, "/")
}

/**
 * Maps a checker diagnostic payload to the client's file diagnostics.
 * A non-array payload is a missing or renamed method, and a non-object entry is a
 * malformed one: both fail CLOSED with a synthetic diagnostic so an oracle caller never
 * treats silence as soundness.
 */
export function toFileDiagnostics(
  raw: unknown,
  probeFileAbs: string,
): ReadonlyArray<FileDiagnostic> {
  if (!Array.isArray(raw)) {
    return [{ code: -1, fileName: probeFileAbs }]
  }
  const probe = toSlashes(probeFileAbs)
  const diagnostics: FileDiagnostic[] = []
  for (const item of raw) {
    if (item === null || typeof item !== "object") {
      diagnostics.push({ code: -1, fileName: probeFileAbs })
      continue
    }
    const diagnostic = item as CheckerDiagnostic
    const fileName = typeof diagnostic.fileName === "string" ? diagnostic.fileName : ""
    // The checker reports slash-normalized RootedFilePath values, while the probe path is
    // built with the host separator. Compare both in one form, or every Windows diagnostic
    // is dropped and the probe reads as clean.
    if (fileName !== "" && toSlashes(fileName) !== probe) {
      continue
    }
    const text = typeof diagnostic.text === "string" ? diagnostic.text : undefined
    diagnostics.push({
      code: typeof diagnostic.code === "number" ? diagnostic.code : 0,
      fileName: fileName === "" ? probeFileAbs : fileName,
      ...(text !== undefined ? { text } : {}),
    })
  }
  return diagnostics
}

/**
 * Resolves the native checker binary shipped with the `typescript` package:
 * `@typescript/typescript-<platform>-<arch>/lib/tsc`. The JS `bin/tsc` launcher is
 * not what the sync API or `--noEmit` probes spawn.
 */
export function resolveTsgoExecutable(override?: string): string {
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`tskm: configured tsgo executable not found: ${override}`)
    }
    return override
  }
  const require = createRequire(import.meta.url)
  let metaPkg: string
  try {
    metaPkg = require.resolve("typescript/package.json")
  } catch {
    throw new Error(
      "tskm: typescript package not found. Install typescript >=7.1.0-beta <8 (the package that provides typescript/sync).",
    )
  }
  const metaRequire = createRequire(metaPkg)
  const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}`
  let platformPkg: string
  try {
    platformPkg = metaRequire.resolve(`${platformPackage}/package.json`)
  } catch {
    throw new Error(
      `tskm: typescript native binary package not found (${platformPackage}). It is an optional dependency of typescript.`,
    )
  }
  const exe = join(dirname(platformPkg), "lib", process.platform === "win32" ? "tsc.exe" : "tsc")
  if (!existsSync(exe)) {
    throw new Error(`tskm: typescript native binary not found at ${exe}`)
  }
  return exe
}

export interface CreateTsgoClientOptions {
  readonly cwd: string
  readonly tsconfigPath: string
  readonly executable?: string
}

interface FileNotifications {
  created?: string[]
  changed?: string[]
  deleted?: string[]
}

interface SnapshotLike {
  getConfiguredProject(configFileName: string): ProjectLike | undefined
  update(params: {
    fileSystem?: unknown
    fileNotifications?: FileNotifications
    ensurePrograms?: boolean
  }): SnapshotLike
  dispose(): void
}

interface SyncApi {
  API: new (options: {
    cwd: string
    tsserverPath: string
    useCaseSensitiveFileNames: boolean
  }) => { createSnapshot(params: { openProjects: string[] }): SnapshotLike; close(): void }
}

interface FsApi {
  createFileSystemLayer(files: ReadonlyArray<readonly [string, string]>): unknown
}

let syncApi: SyncApi | undefined
let fsApi: FsApi | undefined

function loadCheckerApi(): { syncApi: SyncApi; fsApi: FsApi } {
  if (syncApi && fsApi) {
    return { syncApi, fsApi }
  }
  const require = createRequire(import.meta.url)
  syncApi = require(checkerEntrypoint("sync")) as SyncApi
  fsApi = require(checkerEntrypoint("fs")) as FsApi
  return { syncApi, fsApi }
}

function checkerEntrypoint(kind: "sync" | "fs"): string {
  // A split string keeps the bundler from resolving this at build time; the package is
  // an external peer and must be loaded from the user's install at runtime.
  return `typescript/${kind}`
}

interface ProjectLike {
  checker: {
    getTypeAtPosition(file: string, position: number): { flags: number } | undefined
    typeToString(type: { flags: number }, enclosing: undefined, flags: number): string
    getStringType(): { flags: number }
  }
  program: {
    getSemanticDiagnostics(file: string): unknown
  }
}

/**
 * The host file system is case-sensitive except on Windows and macOS.
 * Passed explicitly so the checker matches the host instead of inferring it
 * from a path inside the typescript package.
 */
function inferCaseSensitiveFileNames(): boolean {
  return process.platform !== "win32" && process.platform !== "darwin"
}

function notificationsOf(summary: {
  readonly created?: ReadonlyArray<string>
  readonly changed?: ReadonlyArray<string>
  readonly deleted?: ReadonlyArray<string>
}): FileNotifications | undefined {
  const fileNotifications: FileNotifications = {}
  if (summary.created?.length) {
    fileNotifications.created = [...summary.created]
  }
  if (summary.changed?.length) {
    fileNotifications.changed = [...summary.changed]
  }
  if (summary.deleted?.length) {
    fileNotifications.deleted = [...summary.deleted]
  }
  if (
    fileNotifications.created === undefined &&
    fileNotifications.changed === undefined &&
    fileNotifications.deleted === undefined
  ) {
    return undefined
  }
  return fileNotifications
}

/**
 * Opens one TypeScript project through the official `typescript/sync` API.
 *
 * Query documents are an in-memory file-system layer (`createFileSystemLayer`).
 * They are never written to disk. The project is opened once; later edits go
 * through `updateFile` / `updateFiles` / the overlay methods, which each produce
 * one new snapshot. `typescript/sync` hides the wire `project` handle, so a
 * string-to-number handle change in the server does not reach this client.
 */
export function createTsgoClient(options: CreateTsgoClientOptions): TsgoClient {
  const executable = resolveTsgoExecutable(options.executable)
  const { syncApi: sync, fsApi: fs } = loadCheckerApi()
  // The checker's channel spawns inside the constructor, so only this call needs the Bun
  // pipe-fd wrapper. It is removed again before any other child process can start.
  const api = withBunSyncChannelFds(
    () =>
      new sync.API({
        cwd: options.cwd,
        tsserverPath: executable,
        useCaseSensitiveFileNames: inferCaseSensitiveFileNames(),
      }),
  )
  let snapshot: SnapshotLike
  try {
    snapshot = api.createSnapshot({ openProjects: [options.tsconfigPath] }) as SnapshotLike
    probeStringType(snapshot, options.tsconfigPath)
  } catch (error) {
    try {
      api.close()
    } catch {
      // The original failure is the one callers need.
    }
    throw error
  }

  const overlay = new Map<string, string>()
  let closed = false

  const projectOf = (): ProjectLike => {
    const project = snapshot.getConfiguredProject(options.tsconfigPath)
    if (!project) {
      throw new Error(`tskm: tsconfig opened no projects: ${options.tsconfigPath}`)
    }
    return project
  }

  const commit = (summary: {
    readonly created?: ReadonlyArray<string>
    readonly changed?: ReadonlyArray<string>
    readonly deleted?: ReadonlyArray<string>
  }): void => {
    const fileNotifications = notificationsOf(summary)
    const next = snapshot.update({
      ...(overlay.size > 0 ? { fileSystem: fs.createFileSystemLayer([...overlay.entries()]) } : {}),
      ...(fileNotifications ? { fileNotifications } : {}),
      ensurePrograms: true,
    })
    if (next === snapshot) {
      // updateSnapshot hands back the base object when the server reports no change.
      // Disposing it below would dispose the live snapshot as well.
      return
    }
    const previous = snapshot
    snapshot = next
    previous.dispose()
  }

  const updateFile: TsgoClient["updateFile"] = (absPath, kind) => {
    commit({ [kind]: [absPath] })
  }

  const updateFiles: TsgoClient["updateFiles"] = (summary) => {
    if (!summary.created?.length && !summary.changed?.length && !summary.deleted?.length) {
      return
    }
    commit(summary)
  }

  const applyOverlay: TsgoClient["applyOverlay"] = (entries) => {
    if (entries.length === 0) {
      return
    }
    const created: string[] = []
    const changed: string[] = []
    for (const entry of entries) {
      if (overlay.has(entry.document)) {
        changed.push(entry.document)
      } else {
        created.push(entry.document)
      }
      overlay.set(entry.document, entry.text)
    }
    commit({ created, changed })
  }

  const clearOverlay: TsgoClient["clearOverlay"] = (documents) => {
    const deleted: string[] = []
    for (const document of documents) {
      if (overlay.delete(document)) {
        deleted.push(document)
      }
    }
    if (deleted.length === 0) {
      return
    }
    commit({ deleted })
  }

  const resolveAt = (queryFileAbs: string, position: number): ResolvedType | null => {
    const checker = projectOf().checker
    let type: { flags: number } | undefined
    try {
      type = checker.getTypeAtPosition(queryFileAbs, position)
    } catch (error) {
      // A query document that is not in the project (cleared overlay, bad path)
      // is a missing type, not a crash. Callers already treat null as fail-closed.
      if (error instanceof Error && error.message.includes("source file not found")) {
        return null
      }
      throw error
    }
    if (!type) {
      return null
    }
    return { flags: type.flags, text: checker.typeToString(type, undefined, TYPE_TO_STRING_FLAGS) }
  }

  const withSnapshot: TsgoClient["withSnapshot"] = (fn) => fn(resolveAt)

  const resolveTypeAt: TsgoClient["resolveTypeAt"] = (queryFileAbs, position) =>
    resolveAt(queryFileAbs, position)

  const getDiagnostics: TsgoClient["getDiagnostics"] = (probeFileAbs) => {
    try {
      return toFileDiagnostics(
        projectOf().program.getSemanticDiagnostics(probeFileAbs),
        probeFileAbs,
      )
    } catch {
      return [{ code: -1, fileName: probeFileAbs }]
    }
  }

  const close: TsgoClient["close"] = () => {
    if (closed) {
      return
    }
    closed = true
    try {
      snapshot.dispose()
    } catch {
      // Closing a failed session should still stop the checker process.
    }
    api.close()
  }

  return {
    updateFile,
    updateFiles,
    supportsOverlay: true,
    applyOverlay,
    clearOverlay,
    withSnapshot,
    resolveTypeAt,
    getDiagnostics,
    close,
  }
}

function probeStringType(snapshot: SnapshotLike, tsconfigPath: string): void {
  const project = snapshot.getConfiguredProject(tsconfigPath)
  if (!project) {
    throw new Error(`tskm: tsconfig opened no projects: ${tsconfigPath}`)
  }
  const type = project.checker.getStringType()
  if (!type) {
    throw new Error("tskm: tsgo capability probe failed: getStringType returned no type.")
  }
  const text = project.checker.typeToString(type, undefined, 0)
  if (type.flags & FAILURE_TYPE_FLAGS || text !== "string") {
    throw new Error(
      `tskm: tsgo capability probe failed: expected "string" (got "${text}", flags=${type.flags}).`,
    )
  }
}
