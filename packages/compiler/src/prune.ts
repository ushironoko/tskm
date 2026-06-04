import { referencesTypeOutsideQuotes } from "./token-scan.ts"

/**
 * Dangling-alias prune: the fail-closed backstop between resolution and emission.
 *
 * A structural body may reference a sibling alias (mutual recursion, a thin
 * duplicate re-export) that was DECLARED as a target but ultimately not emitted —
 * its own resolution failed, was skipped as unsupported, or was itself pruned. The
 * identity map already guarantees only declared aliases can appear in a body; this
 * pass guarantees the declared alias is actually IN the final emitted set, pruning
 * (cascade, to a fixpoint) any body whose reference would dangle. Checker bodies
 * are never scanned: the plain `InferOutput` query renders fully inline and cannot
 * carry a sidecar alias name on purpose; a coincidental textual match must not
 * drop a sound resolution.
 */

export interface PruneCandidate {
  readonly typeName: string
  readonly body: string
  /** True when the body came from the structural path (skeleton or Tier-1 splice). */
  readonly structural: boolean
}

export interface PruneResult {
  readonly kept: ReadonlyArray<PruneCandidate>
  readonly diagnostics: ReadonlyArray<string>
}

export function pruneDanglingAliases(
  candidates: ReadonlyArray<PruneCandidate>,
  declaredNames: ReadonlySet<string>,
): PruneResult {
  const kept = [...candidates]
  const diagnostics: string[] = []
  let changed = true
  while (changed) {
    changed = false
    const emitted = new Set(kept.map((c) => c.typeName))
    for (let i = 0; i < kept.length; i++) {
      const candidate = kept[i]
      if (!candidate?.structural) {
        continue
      }
      // referencesTypeOutsideQuotes, NOT a plain token scan: a property KEY named
      // like a sibling alias (`{ CategoryTree: string }`) is a member declaration,
      // not a type reference, and must not prune a sound body.
      const missing = [...declaredNames].find(
        (name) =>
          name !== candidate.typeName &&
          !emitted.has(name) &&
          referencesTypeOutsideQuotes(candidate.body, name),
      )
      if (missing !== undefined) {
        diagnostics.push(
          `tskm: "${candidate.typeName}" references sibling alias "${missing}" which could not be emitted; skipping ${candidate.typeName} (fail-closed). Existing output left untouched.`,
        )
        kept.splice(i, 1)
        // The emitted set just shrank — restart so earlier survivors re-checked
        // against it (the cascade is what makes this a fixpoint).
        changed = true
        break
      }
    }
  }
  return { kept, diagnostics }
}
