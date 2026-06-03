import { globSync, readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import type { ResolvedTskmConfig, TskmMode } from "./config.ts"
import type { DiscoveredSchema } from "./discovery.ts"
import { discoverSchemas } from "./discovery.ts"
import { emitSidecar } from "./emit.ts"
import { collectInplaceTargets, emitInplace } from "./inplace.ts"
import type { ResolvedSchema } from "./resolve.ts"
import { resolveSchemas } from "./resolve.ts"
import { resolveRecursiveSchemas } from "./structural-resolve.ts"
import { createTsgoClient, type TsgoClient } from "./tsgo-client.ts"
import { applyTier1 } from "./verify-splice.ts"

/** Version stamp folded into inplace content hashes (invalidates on generator change). */
export const GENERATOR_VERSION = "tskm-compiler@0.0.0"

export interface GeneratedFile {
  readonly source: string
  /** The written artifact: the sidecar path, or the source path itself for inplace. */
  readonly output: string
  readonly typeNames: ReadonlyArray<string>
  readonly mode: TskmMode
  /** False when inplace skipped the write because every region's hash matched. */
  readonly changed: boolean
}

export interface PerFileResult {
  readonly file: GeneratedFile | null
  readonly diagnostics: ReadonlyArray<string>
}

export interface GenerateResult {
  readonly files: ReadonlyArray<GeneratedFile>
  readonly diagnostics: ReadonlyArray<string>
}

export interface TskmSession {
  readonly config: ResolvedTskmConfig
  /** All source files matched by the include globs (sorted, sidecars/queries excluded). */
  collectSources(): ReadonlyArray<string>
  /** Generates types for one source file, notifying the checker of its current content. */
  generateFile(sourceAbs: string, pretty?: boolean): PerFileResult
  /** Generates types for every included source file. */
  generateAll(pretty?: boolean): GenerateResult
  close(): void
}

/** True for paths the compiler itself produces, which must never be scanned as sources. */
function isGeneratedArtifact(absPath: string): boolean {
  return absPath.endsWith(".gen.ts") || absPath.endsWith(".tskm-query.ts")
}

export interface TargetSplit {
  /** Non-recursive targets: resolved statically by the tsgo `InferOutput` query. */
  readonly checkerTargets: ReadonlyArray<DiscoveredSchema>
  /** Recursive targets: resolved by the structural worker (the only eval path). */
  readonly structuralTargets: ReadonlyArray<DiscoveredSchema>
}

/**
 * Pure routing between the two resolution paths. Recursive schemas must not reach
 * the plain checker query (their self positions collapse and `FAILURE_TYPE_FLAGS`
 * would mask the cause); everything else stays on the static path. An empty
 * `structuralTargets` guarantees the structural worker is never spawned for the
 * file — the zero-cost property for non-recursive projects.
 */
export function splitTargets(targets: ReadonlyArray<DiscoveredSchema>): TargetSplit {
  return {
    checkerTargets: targets.filter((t) => !t.recursive),
    structuralTargets: targets.filter((t) => t.recursive),
  }
}

function collectSources(config: ResolvedTskmConfig): ReadonlyArray<string> {
  const matches = new Set<string>()
  for (const pattern of config.include) {
    for (const match of globSync(pattern, { cwd: config.root })) {
      const abs = isAbsolute(match) ? match : resolve(config.root, match)
      if (isGeneratedArtifact(abs)) {
        continue
      }
      matches.add(abs)
    }
  }
  return [...matches].sort()
}

function makeRootRelative(diagnostics: ReadonlyArray<string>, root: string): ReadonlyArray<string> {
  return diagnostics.map((d) => d.replaceAll(`${root}/`, ""))
}

/**
 * Long-lived compile session: a single tsgo client bound to one open project, reused
 * across every file (and across watch ticks). `generateFile` notifies the checker of
 * the file's current on-disk content (`fileChanges: changed`) before resolving, so it
 * is correct both for a cold one-shot run and for a file edited after the project was
 * opened.
 */
export function createSession(config: ResolvedTskmConfig): TskmSession {
  const client: TsgoClient = createTsgoClient({
    cwd: config.root,
    tsconfigPath: config.tsconfig,
    executable: config.executable,
  })

  const generateFile: TskmSession["generateFile"] = (sourceAbs, pretty = true) => {
    const sourceText = readFileSync(sourceAbs, "utf8")
    const discovery = discoverSchemas(sourceAbs, sourceText)

    // In inplace mode only explicit `Infer` aliases (and existing sentinels) are
    // targets; auto-discovered `const` schemas have no marker to rewrite.
    let targets = discovery.schemas
    const extraDiagnostics: string[] = []
    if (config.mode === "inplace") {
      const aliases = discovery.schemas.filter((s) => s.origin === "alias")
      const collected = collectInplaceTargets(sourceText, aliases)
      // Sentinel-region targets carry only names; re-attach recursiveness from the
      // file's full discovery so a recursive region routes to the structural path.
      const recursiveByName = new Map(discovery.schemas.map((s) => [s.name, s.recursive]))
      targets = collected.targets.map((t) =>
        t.recursive ? t : { ...t, recursive: recursiveByName.get(t.name) ?? false },
      )
      extraDiagnostics.push(...collected.diagnostics)
    }

    if (targets.length === 0) {
      return { file: null, diagnostics: [...discovery.diagnostics, ...extraDiagnostics] }
    }

    // The split happens AFTER the inplace alias filter so recursive markers keep
    // their routing; recursive schemas never reach the plain checker query.
    const { checkerTargets, structuralTargets } = splitTargets(targets)

    // Inform the checker of the file's current content before querying it.
    client.updateFile(sourceAbs, "changed")

    const checkerResult = resolveSchemas(client, sourceAbs, checkerTargets)
    const structuralResult = resolveRecursiveSchemas(sourceAbs, structuralTargets, {
      root: config.root,
      execPath: config.worker.execPath ?? process.execPath,
      timeoutMs: config.worker.timeoutMs,
    })

    // Tier-1: transform-bearing recursive roots try the sentinel-unroll splice; a
    // candidate is used ONLY when the cross-check + fixpoint oracle both pass,
    // otherwise the Tier-2 skeleton stands.
    const tier1 = applyTier1(client, sourceAbs, structuralResult.resolutions)

    // Merge both paths back into DISCOVERY order so mixed files emit stably.
    const byTypeName = new Map<string, string>()
    for (const r of checkerResult.resolved) {
      byTypeName.set(r.typeName, r.typeString)
    }
    for (const r of structuralResult.resolutions) {
      byTypeName.set(r.typeName, tier1.upgraded.get(r.typeName) ?? r.skeleton)
    }
    const resolved: ResolvedSchema[] = []
    for (const target of targets) {
      const typeString = byTypeName.get(target.typeName)
      if (typeString !== undefined) {
        resolved.push({ typeName: target.typeName, typeString })
      }
    }

    const allDiagnostics = [
      ...discovery.diagnostics,
      ...extraDiagnostics,
      ...checkerResult.diagnostics,
      ...structuralResult.diagnostics,
      ...tier1.diagnostics,
    ]
    if (resolved.length === 0) {
      return { file: null, diagnostics: allDiagnostics }
    }

    if (config.mode === "inplace") {
      const emitted = emitInplace(sourceAbs, sourceText, resolved, {
        pretty,
        version: GENERATOR_VERSION,
      })
      return {
        file: {
          source: sourceAbs,
          output: emitted.source,
          typeNames: emitted.typeNames,
          mode: "inplace",
          changed: emitted.changed,
        },
        diagnostics: [...allDiagnostics, ...emitted.diagnostics],
      }
    }

    const emitted = emitSidecar(sourceAbs, resolved, { pretty })
    return {
      file: {
        source: sourceAbs,
        output: emitted.sidecar,
        typeNames: resolved.map((r) => r.typeName),
        mode: "sidecar",
        changed: true,
      },
      diagnostics: allDiagnostics,
    }
  }

  const generateAll: TskmSession["generateAll"] = (pretty = true) => {
    const sources = collectSources(config)
    if (sources.length === 0) {
      return {
        files: [],
        diagnostics: [`tskm: no source files matched ${config.include.join(", ")}`],
      }
    }
    const files: GeneratedFile[] = []
    const diagnostics: string[] = []
    for (const sourceAbs of sources) {
      const result = generateFile(sourceAbs, pretty)
      diagnostics.push(...result.diagnostics)
      if (result.file) {
        files.push(result.file)
      }
    }
    return { files, diagnostics: makeRootRelative(diagnostics, config.root) }
  }

  return {
    config,
    collectSources: () => collectSources(config),
    generateFile,
    generateAll,
    close: () => client.close(),
  }
}
