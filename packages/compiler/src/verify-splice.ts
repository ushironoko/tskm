import { rmSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import type { StructuralResolution } from "./structural-resolve.ts"
import { resolveSentinelUnroll, substituteSentinel } from "./tier1.ts"
import { containsTokenOutsideQuotes } from "./token-scan.ts"
import type { TsgoClient } from "./tsgo-client.ts"

/**
 * The Tier-1 emission gates. A spliced candidate is emitted ONLY when BOTH pass;
 * any rejection keeps the Tier-2 structural skeleton (never a wrong type):
 *
 * 1. DATA-PROPERTY CROSS-CHECK — the one guard the oracle cannot replace. A lib
 *    bug that corrupts the unroll AND the fixpoint reference identically (brand
 *    intersection absorbing the object body: `unknown & Brand = Brand`) makes the
 *    oracle pass vacuously; comparing the checker output against the STRUCTURAL
 *    walk's own data keys catches exactly that case.
 * 2. FIXPOINT ORACLE — feed the candidate alias back as its own `self`:
 *    `Unroll = InferOutput<ReturnType<typeof X.build<BaseSchema<C, C>>>>` must be
 *    BIDIRECTIONALLY assignable with the candidate `C`. The naive comparison
 *    against `InferOutput<typeof X>` would be vacuous (a recursive root's own
 *    InferOutput is loose); the fixpoint form is the non-vacuous one — a wrong
 *    transform output fails with TS2322, a missing field with TS2741.
 */

export interface SpliceVerdict {
  readonly sound: boolean
  readonly reason?: string
}

/**
 * Structural-vs-checker cross-check: when the walk saw own data keys on the root
 * body, the checker's rendered candidate must mention at least one of them. Zero
 * overlap means an intersection absorbed the body. (Missing SOME keys is left to
 * the oracle, which detects it precisely as a TS2741.)
 */
export function crossCheckDataKeys(
  candidate: string,
  dataKeys: ReadonlyArray<string>,
): SpliceVerdict {
  if (dataKeys.length === 0) {
    return { sound: true }
  }
  const present = dataKeys.some((key) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(?:^|[{;(\\s])(?:"${escaped}"|'${escaped}'|${escaped})\\??:`).test(candidate)
  })
  return present
    ? { sound: true }
    : {
        sound: false,
        reason: `the checker output carries none of the structural data keys (${dataKeys.join(
          ", ",
        )}) — intersection absorption suspected`,
      }
}

/** The oracle probe file: a sibling with the excluded `.tskm-query.ts` suffix. */
export function oracleProbePath(sourceFileAbs: string, index: number): string {
  const dir = dirname(sourceFileAbs)
  const base = basename(sourceFileAbs, extname(sourceFileAbs))
  return join(dir, `${base}.tier1-probe-${index}.tskm-query.ts`)
}

/**
 * Builds the bidirectional fixpoint probe body for one candidate. The candidate is
 * declared under its REAL alias name so the body's self-references (`children:
 * S2[]`) resolve to the local declaration — exactly the alias the sidecar will
 * export.
 */
export function buildFixpointProbe(
  sourceImportPath: string,
  exportName: string,
  typeName: string,
  candidateBody: string,
): string {
  return [
    `import { ${exportName} } from "${sourceImportPath}"`,
    `import type { BaseSchema, InferOutput } from "@tskm/core"`,
    "type __P<T> = { [K in keyof T]: T[K] } & {}",
    `type ${typeName} = ${candidateBody}`,
    `type __Unroll = __P<InferOutput<ReturnType<typeof ${exportName}.build<BaseSchema<${typeName}, ${typeName}>>>>>`,
    `declare const __c: ${typeName}`,
    "declare const __u: __Unroll",
    "export const __d1: __Unroll = __c",
    `export const __d2: ${typeName} = __u`,
    "",
  ].join("\n")
}

function sourceImportSpecifier(sourceFileAbs: string): string {
  const base = basename(sourceFileAbs, extname(sourceFileAbs))
  return `./${base}`
}

/**
 * Runs the fixpoint oracle for one candidate through the live client. Zero
 * diagnostics in the probe file === sound; anything else (including the client's
 * fail-closed synthetic diagnostic) rejects.
 */
export function verifyFixpoint(
  client: TsgoClient,
  sourceFileAbs: string,
  exportName: string,
  typeName: string,
  candidateBody: string,
  index: number,
): SpliceVerdict {
  const probeFile = oracleProbePath(sourceFileAbs, index)
  const body = buildFixpointProbe(
    sourceImportSpecifier(sourceFileAbs),
    exportName,
    typeName,
    candidateBody,
  )
  try {
    writeFileSync(probeFile, body)
    client.updateFile(probeFile, "created")
    const diagnostics = client.getDiagnostics(probeFile)
    if (diagnostics.length === 0) {
      return { sound: true }
    }
    const codes = diagnostics.map((d) => `TS${d.code}`).join(", ")
    return { sound: false, reason: `fixpoint oracle rejected the candidate (${codes})` }
  } finally {
    rmSync(probeFile, { force: true })
    client.updateFile(probeFile, "deleted")
  }
}

export interface Tier1Outcome {
  /** typeName -> verified Tier-1 body, for the roots whose splice passed BOTH gates. */
  readonly upgraded: ReadonlyMap<string, string>
  readonly diagnostics: ReadonlyArray<string>
}

/**
 * Attempts the Tier-1 upgrade for every transform-bearing structural resolution:
 * sentinel unroll -> substitution guards -> data-key cross-check -> fixpoint
 * oracle. Each rejection is a diagnostic + skeleton-keep; only fully verified
 * candidates land in `upgraded`.
 */
export function applyTier1(
  client: TsgoClient,
  sourceFileAbs: string,
  resolutions: ReadonlyArray<StructuralResolution>,
): Tier1Outcome {
  const targets = resolutions.filter((r) => r.bearsOpaque)
  if (targets.length === 0) {
    return { upgraded: new Map(), diagnostics: [] }
  }

  const diagnostics: string[] = []
  const upgraded = new Map<string, string>()
  const unroll = resolveSentinelUnroll(
    client,
    sourceFileAbs,
    targets.map((t) => ({ exportName: t.exportName, typeName: t.typeName })),
  )
  diagnostics.push(...unroll.diagnostics)

  targets.forEach((target, i) => {
    const raw = unroll.unrolled.get(i)
    if (raw === undefined) {
      return // already covered by an unroll diagnostic
    }
    // The skeleton references its own alias exactly when the root self-cycles; the
    // unroll must then carry the sentinel at those positions.
    const selfReferential = containsTokenOutsideQuotes(target.skeleton, target.typeName)
    const substituted = substituteSentinel(raw, i, target.typeName, selfReferential)
    if (substituted.failure !== undefined || substituted.typeString === undefined) {
      diagnostics.push(
        `tskm: Tier-1 candidate for ${target.typeName} rejected (${substituted.failure ?? "no result"}); keeping the structural skeleton.`,
      )
      return
    }
    const cross = crossCheckDataKeys(substituted.typeString, target.dataKeys)
    if (!cross.sound) {
      diagnostics.push(
        `tskm: Tier-1 candidate for ${target.typeName} rejected (${cross.reason}); keeping the structural skeleton.`,
      )
      return
    }
    const oracle = verifyFixpoint(
      client,
      sourceFileAbs,
      target.exportName,
      target.typeName,
      substituted.typeString,
      i,
    )
    if (!oracle.sound) {
      diagnostics.push(
        `tskm: Tier-1 candidate for ${target.typeName} rejected (${oracle.reason}); keeping the structural skeleton.`,
      )
      return
    }
    upgraded.set(target.typeName, substituted.typeString)
  })

  return { upgraded, diagnostics }
}
