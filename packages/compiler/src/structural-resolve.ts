import type { DiscoveredSchema } from "./discovery.ts"
import { resolveWorker, runWorker } from "./worker-harness.ts"

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
}

export interface StructuralResolveResult {
  readonly resolutions: ReadonlyArray<StructuralResolution>
  readonly diagnostics: ReadonlyArray<string>
}

interface StructuralEntry {
  readonly name: string
  readonly typeName: string
  readonly recursive: boolean
  readonly typeString: string
  readonly bearsOpaque: boolean
  readonly opaquePaths: ReadonlyArray<string>
  readonly dataKeys: ReadonlyArray<string>
  readonly unsupported: boolean
  readonly warnings: ReadonlyArray<string>
}

interface StructuralEnvelope {
  readonly schemas?: ReadonlyArray<StructuralEntry>
  readonly error?: string
}

export interface ResolveRecursiveOptions {
  readonly root: string
  readonly execPath: string
  readonly timeoutMs: number
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
  // Discovery's typeName is the single naming source: it rides into the worker so
  // alias-renamed targets (`export type TreeNode = Infer<typeof nodeSchema>`) emit
  // back-edges that exactly match the declared alias.
  const overrides = Object.fromEntries(targets.map((t) => [t.name, t.typeName]))
  const run = runWorker<StructuralEnvelope>(workerAbs, sourceAbs, {
    root: options.root,
    execPath: options.execPath,
    timeoutMs: options.timeoutMs,
    tag: "structural",
    extraArgs: [JSON.stringify(overrides)],
  })
  if (run.diagnostic !== undefined) {
    return { resolutions: [], diagnostics: [run.diagnostic] }
  }

  const byExport = new Map<string, StructuralEntry>()
  for (const entry of run.envelope.schemas ?? []) {
    byExport.set(entry.name, entry)
  }

  const resolutions: StructuralResolution[] = []
  const diagnostics: string[] = []
  for (const target of targets) {
    const entry = byExport.get(target.name)
    if (!entry) {
      diagnostics.push(
        `tskm: could not structurally resolve "${target.name}" (not found among module exports); skipping ${target.typeName}. Existing output left untouched.`,
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
    diagnostics.push(...entry.warnings)
    if (entry.unsupported) {
      continue
    }
    resolutions.push({
      typeName: target.typeName,
      exportName: target.name,
      skeleton: entry.typeString,
      bearsOpaque: entry.bearsOpaque,
      opaquePaths: entry.opaquePaths,
      dataKeys: entry.dataKeys,
    })
  }
  return { resolutions, diagnostics }
}
