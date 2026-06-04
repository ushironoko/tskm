import type { DiscoveredSchema } from "./discovery.ts"
import type { StructuralWorkerEntry } from "./structural-ts.ts"
import { resolveWorker, runWorker, type SchemaWorkerEnvelope } from "./worker-harness.ts"

/**
 * Parent-side driver for the structural recursive-type worker: spawns one isolated
 * run per source file (only when discovery flagged at least one `recursive(...)`
 * schema, so non-recursive projects never pay a subprocess), and maps the envelope
 * back onto the discovered targets. The R6 discipline carries over: any failure is
 * a diagnostic + skip — existing output is never overwritten with garbage.
 */

export interface StructuralResolution {
  readonly typeName: string
  /** The export binding name (the `typeof` target / module export). */
  readonly exportName: string
  /** The structural skeleton body (Tier-2 floor: opaque positions as `unknown`). */
  readonly skeleton: string
  /** True when a transform sat under the root — Tier-1's sentinel-unroll routing bit. */
  readonly bearsOpaque: boolean
  /** Path-precise addresses of the opaque positions (diagnostics). */
  readonly opaquePaths: ReadonlyArray<string>
  /** Structural side of the brand-absorption cross-check. */
  readonly dataKeys: ReadonlyArray<string>
  /**
   * The walker's per-root warnings (e.g. the Tier-2 `unknown` notes). Surfaced by
   * the session ONLY when the skeleton is what actually gets emitted — a successful
   * Tier-1 upgrade supersedes them.
   */
  readonly warnings: ReadonlyArray<string>
}

export interface StructuralResolveResult {
  readonly resolutions: ReadonlyArray<StructuralResolution>
  readonly diagnostics: ReadonlyArray<string>
}

export interface ResolveRecursiveOptions {
  readonly root: string
  readonly execPath: string
  readonly timeoutMs: number
}

/**
 * Splits targets into one CANONICAL target per export binding (first in discovery
 * order) and the duplicate declared aliases for the same binding. Only canonicals
 * are walked; each duplicate becomes a thin re-export of its canonical alias
 * (`type Dup = Canonical`), so no emitted alias can self-reference a DIFFERENT
 * declared alias through the identity map.
 */
export function splitCanonicalTargets(targets: ReadonlyArray<DiscoveredSchema>): {
  readonly canonical: ReadonlyArray<DiscoveredSchema>
  readonly duplicates: ReadonlyArray<{
    readonly target: DiscoveredSchema
    readonly canonicalName: string
  }>
} {
  const canonical: DiscoveredSchema[] = []
  const duplicates: Array<{ target: DiscoveredSchema; canonicalName: string }> = []
  const canonicalByExport = new Map<string, string>()
  for (const target of targets) {
    const seen = canonicalByExport.get(target.name)
    if (seen === undefined) {
      canonicalByExport.set(target.name, target.typeName)
      canonical.push(target)
    } else {
      duplicates.push({ target, canonicalName: seen })
    }
  }
  return { canonical, duplicates }
}

export function resolveRecursiveSchemas(
  sourceAbs: string,
  targets: ReadonlyArray<DiscoveredSchema>,
  options: ResolveRecursiveOptions,
): StructuralResolveResult {
  if (targets.length === 0) {
    return { resolutions: [], diagnostics: [] }
  }

  const workerAbs = resolveWorker("structural-ts-worker")
  const { canonical, duplicates } = splitCanonicalTargets(targets)
  // Discovery's typeName is the single naming source: the ordered pairs ride into
  // the worker (argv[4]) and seed the target-driven identity map, so back-edges and
  // cross-references exactly match the aliases this sidecar declares — and nothing
  // else (re-exports and helper schemas stay out of the map).
  const pairs = canonical.map((t) => [t.name, t.typeName] as const)
  const run = runWorker<SchemaWorkerEnvelope<StructuralWorkerEntry>>(workerAbs, sourceAbs, {
    root: options.root,
    execPath: options.execPath,
    timeoutMs: options.timeoutMs,
    tag: "structural",
    extraArgs: [JSON.stringify(pairs)],
  })
  if (run.diagnostic !== undefined) {
    return { resolutions: [], diagnostics: [run.diagnostic] }
  }

  const byExport = new Map<string, StructuralWorkerEntry>()
  for (const entry of run.envelope.schemas ?? []) {
    byExport.set(entry.name, entry)
  }

  const resolutions: StructuralResolution[] = []
  const diagnostics: string[] = []
  for (const target of canonical) {
    const entry = byExport.get(target.name)
    if (!entry) {
      diagnostics.push(
        `tskm: could not structurally resolve "${target.name}" (not found among module exports — is the const exported?); skipping ${target.typeName}. Existing output left untouched.`,
      )
      continue
    }
    if (!entry.recursive) {
      // Discovery flagged it syntactically but the runtime object is not a
      // recursive() root (e.g. a wrapper hid it). Degrade-safe: skip with the
      // checker path untouched for everything else.
      diagnostics.push(
        `tskm: "${target.name}" was flagged recursive but its runtime object is not a recursive() schema; skipping ${target.typeName}. Existing output left untouched.`,
      )
      continue
    }
    if (entry.unsupported) {
      diagnostics.push(...entry.warnings)
      continue
    }
    resolutions.push({
      typeName: target.typeName,
      exportName: target.name,
      skeleton: entry.typeString,
      bearsOpaque: entry.bearsOpaque,
      opaquePaths: entry.opaquePaths,
      dataKeys: entry.dataKeys,
      warnings: entry.warnings,
    })
  }

  // Thin re-exports for duplicate declared aliases — emitted only when their
  // canonical actually resolved, so they can never dangle.
  const resolvedNames = new Set(resolutions.map((r) => r.typeName))
  for (const { target, canonicalName } of duplicates) {
    if (target.typeName === canonicalName) {
      // Same alias name on the same binding (`export const aSchema` + `export type
      // A = Infer<typeof aSchema>`): one declaration intent, already emitted by the
      // canonical — a thin `type A = A` would be circular (TS2456). Drop silently.
      // (The session-level typeName dedupe normally catches this first; this is
      // the in-module backstop.)
      continue
    }
    if (!resolvedNames.has(canonicalName)) {
      diagnostics.push(
        `tskm: "${target.typeName}" duplicates the alias for export "${target.name}", whose canonical alias ${canonicalName} could not be resolved; skipping ${target.typeName}. Existing output left untouched.`,
      )
      continue
    }
    diagnostics.push(
      `tskm: "${target.typeName}" duplicates the alias for export "${target.name}"; emitted as a re-export of ${canonicalName}.`,
    )
    resolutions.push({
      typeName: target.typeName,
      exportName: target.name,
      skeleton: canonicalName,
      bearsOpaque: false,
      opaquePaths: [],
      dataKeys: [],
      warnings: [],
    })
  }

  return { resolutions, diagnostics }
}
