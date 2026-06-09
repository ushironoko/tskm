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

/**
 * The type names whose structural body is a bare alias reference that forms a cycle with other
 * resolutions (e.g. a bare mutual `lazy`, `type A = B` + `type B = A`, which TypeScript rejects
 * with TS2456, or a self-cycle `type A = A`). Emitting those is a non-compiling sidecar, so the
 * caller drops them and lets the checker type stand (issue #22 review, G4). A single alias to a
 * real body (`type Dup = Canonical`) does not form a cycle and is preserved.
 */
export function bareAliasCycleNames(
  resolutions: ReadonlyArray<{ readonly typeName: string; readonly skeleton: string }>,
): ReadonlySet<string> {
  const bodyByName = new Map(resolutions.map((r) => [r.typeName, r.skeleton]))
  // A bare alias reference is a declared type name with NO surrounding type syntax. Keying off
  // `bodyByName` (the emitted names) keeps this identifier-correctness-agnostic, so a Unicode
  // type name (`deriveTypeName` does not ASCII-sanitize) is still recognized; the syntax check
  // only rejects a compound body that happens to collide with a name.
  const isAliasRef = (body: string): boolean =>
    !/[\s.|&<>{}()[\]"'`,;:?=]/.test(body) && bodyByName.has(body)
  const formsCycle = (start: string): boolean => {
    let current = start
    const seen = new Set<string>([start])
    let body = bodyByName.get(current)
    while (body !== undefined && isAliasRef(body)) {
      if (body === start) return true
      if (seen.has(body)) return false // a cycle that does not pass back through `start`
      seen.add(body)
      current = body
      body = bodyByName.get(current)
    }
    return false
  }
  return new Set(resolutions.filter((r) => formsCycle(r.typeName)).map((r) => r.typeName))
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
    if (!entry.recursive && target.recursive) {
      // Discovery flagged it recursive but the runtime object is not a recursive()
      // root (e.g. a wrapper hid it). Degrade-safe: skip with the checker path
      // untouched for everything else. A target discovery already knows is
      // non-recursive (routed here by `nameSharedSchemas`, issue #22) is NOT skipped:
      // it is a sibling we asked to alias, and the worker walked it fully.
      diagnostics.push(
        `tskm: "${target.name}" was flagged recursive but its runtime object is not a recursive() schema; skipping ${target.typeName}. Existing output left untouched.`,
      )
      continue
    }
    if (entry.unsupported) {
      diagnostics.push(...entry.warnings)
      continue
    }
    if (
      !target.recursive &&
      (entry.typeString === "" || entry.bearsOpaque || entry.bearsUnsupported)
    ) {
      // A flag-routed non-recursive sibling (issue #22) the walker could not render
      // losslessly: an empty body means the value is not a tskm-walkable schema (e.g.
      // `const x = parse(...)`), an opaque body means a transform whose output type only
      // the checker knows, and `bearsUnsupported` means the walk fell back to a bare
      // `unknown` for an unsupported node (e.g. a `fallback()` or any type the walker does
      // not handle). Skip the structural resolution so the CHECKER type stands for this
      // target (it rides both paths under the flag); never emit an empty or `unknown` alias
      // that would overwrite the correct checker output.
      if (entry.typeString === "") {
        diagnostics.push(
          `tskm: "${target.name}" is not a structurally-aliasable schema; using the checker-resolved type for ${target.typeName}.`,
        )
      } else if (entry.bearsUnsupported) {
        diagnostics.push(
          `tskm: "${target.name}" has a position the structural walker cannot type (emitted 'unknown'); using the checker-resolved type for ${target.typeName}.`,
        )
      }
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

  // Drop any structural resolution whose body is a bare alias name forming a cycle with other
  // resolutions (e.g. a bare mutual `lazy`: `type A = B; type B = A`, which is TS2456). Emitting
  // those is a non-compiling sidecar; dropping them lets the CHECKER type stand, so the flag
  // never produces output worse than flag-off for these targets (issue #22 review, G4).
  const cyclic = bareAliasCycleNames(resolutions)
  if (cyclic.size > 0) {
    for (const name of cyclic) {
      diagnostics.push(
        `tskm: "${name}" resolves to a bare alias cycle (e.g. mutual lazy); using the checker-resolved type instead of a non-compiling alias.`,
      )
    }
    for (let i = resolutions.length - 1; i >= 0; i--) {
      if (cyclic.has(resolutions[i]?.typeName ?? "")) {
        resolutions.splice(i, 1)
      }
    }
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
