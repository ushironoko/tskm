import { globSync, readFileSync } from "node:fs"
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path"
import type { ResolvedTskmConfig, TskmMode } from "./config.ts"
import type { DiscoveredSchema } from "./discovery.ts"
import { discoverSchemas } from "./discovery.ts"
import { emitSidecar, renderSidecar } from "./emit.ts"
import { collectInplaceTargets, emitInplace } from "./inplace.ts"
import { type PruneCandidate, pruneDanglingAliases } from "./prune.ts"
import { sourceImportSpecifier, withQueryFile } from "./query-core.ts"
import type { ResolvedSchema } from "./resolve.ts"
import { resolveSchemas } from "./resolve.ts"
import { resolveRecursiveSchemas } from "./structural-resolve.ts"
import { createTsgoClient, type TsgoClient } from "./tsgo-client.ts"
import { applyTier1 } from "./verify-splice.ts"

/** The compile-gate probe file: a sibling with the excluded `.tskm-query.ts` suffix. */
function verifyFilePath(sourceFileAbs: string): string {
  const dir = dirname(sourceFileAbs)
  const base = basename(sourceFileAbs, extname(sourceFileAbs))
  return join(dir, `${base}.verify.tskm-query.ts`)
}

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
  /** Checker-route targets: resolved statically by the tsgo `~standard` query. */
  readonly checkerTargets: ReadonlyArray<DiscoveredSchema>
  /** tskm-recursive targets: resolved by the structural worker (the only eval path). */
  readonly structuralTargets: ReadonlyArray<DiscoveredSchema>
}

/**
 * Pure routing between the two resolution paths, keyed on the capability's
 * `typeResolver` (not the raw `recursive` bit): tskm `recursive(...)` schemas must
 * not reach the plain checker query (their self positions collapse and
 * `FAILURE_TYPE_FLAGS` would mask the cause), and only they may enter the
 * structural worker — external schemas never do, whatever their shape. An empty
 * `structuralTargets` guarantees the structural worker is never spawned for the
 * file — the zero-cost property for non-recursive projects.
 */
export function splitTargets(targets: ReadonlyArray<DiscoveredSchema>): TargetSplit {
  return {
    checkerTargets: targets.filter((t) => t.capability.typeResolver === "standard-checker"),
    structuralTargets: targets.filter((t) => t.capability.typeResolver === "core-recursive"),
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
    const discovery = discoverSchemas(sourceAbs, sourceText, {
      schemaSources: config.schemaSources,
    })

    // In inplace mode only explicit `Infer` aliases (and existing sentinels) are
    // targets; auto-discovered `const` schemas have no marker to rewrite.
    let targets = discovery.schemas
    const extraDiagnostics: string[] = []
    if (config.mode === "inplace") {
      const aliases = discovery.schemas.filter((s) => s.origin === "alias")
      const collected = collectInplaceTargets(sourceText, aliases)
      // Sentinel-region targets carry only names; re-attach the capability from the
      // file's full discovery so a recursive region routes to the structural path.
      const capabilityByName = new Map(discovery.schemas.map((s) => [s.name, s.capability]))
      targets = collected.targets.map((t) => {
        if (t.recursive) {
          return t
        }
        const capability = capabilityByName.get(t.name)
        if (!capability) {
          return t
        }
        return { ...t, recursive: capability.typeResolver === "core-recursive", capability }
      })
      // External schemas have no inplace contract (their markers are vendor
      // idioms, not tskm's `Infer`): say so EXPLICITLY — silent staleness in a
      // mixed file would read as "up to date".
      const unsupported = targets.filter((t) => !t.capability.inplaceSupported)
      for (const t of unsupported) {
        const vendor = t.capability.vendorHint ? ` (${t.capability.vendorHint})` : ""
        extraDiagnostics.push(
          `tskm: inplace mode supports only tskm schemas; "${t.name}" is an external Standard Schema${vendor}; skipped. Use sidecar mode for external schemas.`,
        )
      }
      targets = targets.filter((t) => t.capability.inplaceSupported)
      extraDiagnostics.push(...collected.diagnostics)
    }

    // One emitted alias per typeName, fail-closed: two DISTINCT exports can derive
    // the same name (`user` and `userSchema` both -> `User`), which would otherwise
    // crash renderSidecar's duplicate guard and abort the whole run. The first
    // declaration (discovery order) wins; a same-export duplicate (the canonical
    // `export const aSchema = ...` + `export type A = Infer<typeof aSchema>` pair)
    // is the SAME declaration intent and drops silently.
    const seenTypeNames = new Map<string, string>()
    targets = targets.filter((t) => {
      const owner = seenTypeNames.get(t.typeName)
      if (owner === undefined) {
        seenTypeNames.set(t.typeName, t.name)
        return true
      }
      if (owner !== t.name) {
        extraDiagnostics.push(
          `tskm: duplicate generated type name "${t.typeName}" (exports "${owner}" and "${t.name}"); skipping the later declaration. Existing output left untouched.`,
        )
      }
      return false
    })

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
    const structuralNames = new Set<string>()
    const structuralWarnings = new Map<string, ReadonlyArray<string>>()
    for (const r of checkerResult.resolved) {
      byTypeName.set(r.typeName, r.typeString)
    }
    for (const r of structuralResult.resolutions) {
      const upgradedBody = tier1.upgraded.get(r.typeName)
      byTypeName.set(r.typeName, upgradedBody ?? r.skeleton)
      // Only SKELETON bodies are prune-scanned: the walker is the one writer that
      // can introduce sibling alias references. A Tier-1 body is checker-rendered
      // (fully inline; the substitution introduces only the root's OWN alias), so
      // a textual match there — e.g. a property KEY named like a sibling — must
      // not drop a sound resolution.
      if (upgradedBody === undefined) {
        structuralNames.add(r.typeName)
      }
      // The skeleton's honest-degradation notes matter only when the skeleton is
      // what actually ships: a successful Tier-1 splice supersedes them, and a
      // pruned resolution (below) must not surface notes for a body never emitted.
      structuralWarnings.set(r.typeName, upgradedBody === undefined ? r.warnings : [])
    }
    const candidates: PruneCandidate[] = []
    for (const target of targets) {
      const body = byTypeName.get(target.typeName)
      if (body !== undefined) {
        candidates.push({
          typeName: target.typeName,
          body,
          structural: structuralNames.has(target.typeName),
        })
      }
    }

    // Fail-closed backstop: drop (cascade) any structural body referencing a
    // declared sibling alias that did not make it into the emitted set.
    const declared = new Set(targets.map((t) => t.typeName))
    const pruned = pruneDanglingAliases(candidates, declared)
    // Re-attach per-target metadata (vendor, annotation) lost through the
    // body-string merge — emit derives its import lines from it.
    const targetByTypeName = new Map(targets.map((t) => [t.typeName, t]))
    const resolved: ResolvedSchema[] = pruned.kept.map((c) => {
      const target = targetByTypeName.get(c.typeName)
      return {
        typeName: c.typeName,
        typeString: c.body,
        sourceName: target?.name,
        vendorHint: target?.capability.vendorHint,
        ...(target?.recursiveAnnotation ? { recursiveAnnotation: target.recursiveAnnotation } : {}),
      }
    })
    const skeletonWarnings: string[] = []
    for (const c of pruned.kept) {
      skeletonWarnings.push(...(structuralWarnings.get(c.typeName) ?? []))
    }

    const allDiagnostics = [
      ...discovery.diagnostics,
      ...extraDiagnostics,
      ...checkerResult.diagnostics,
      ...structuralResult.diagnostics,
      ...skeletonWarnings,
      ...tier1.diagnostics,
      ...pruned.diagnostics,
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

    // POST-RESOLUTION COMPILE GATE (external schemas only — tskm-only files skip
    // it, keeping their zero-cost path): "the type resolved" and "the sidecar
    // compiles" are separate guarantees. Leaked vendor internals or annotation
    // types the import slot cannot satisfy fail HERE, before anything is
    // written. Verify-then-write (not write-then-rollback): rewriting the
    // sidecar on failure would look like a foreign change to watch's self-write
    // tracking and risk a rebuild loop; a `.tskm-query.ts` sibling is excluded
    // from watch and always cleaned up by withQueryFile.
    const needsVerify = resolved.some(
      (r) => r.vendorHint !== undefined || r.recursiveAnnotation !== undefined,
    )
    if (needsVerify) {
      const content = renderSidecar(resolved, {
        pretty,
        sourceImportPath: sourceImportSpecifier(sourceAbs),
      })
      const verifyFile = verifyFilePath(sourceAbs)
      const verifyDiags = withQueryFile(client, verifyFile, content, () =>
        client.getDiagnostics(verifyFile),
      )
      if (verifyDiags.length > 0) {
        const codes = [...new Set(verifyDiags.map((d) => `TS${d.code}`))].join(", ")
        return {
          file: null,
          diagnostics: [
            ...allDiagnostics,
            `tskm: the generated types for ${sourceAbs} do not compile (${codes}); nothing written. Existing output left untouched.`,
          ],
        }
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
