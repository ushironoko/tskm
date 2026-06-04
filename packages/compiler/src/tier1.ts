import { rmSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { replaceTokenOutsideQuotes } from "./token-scan.ts"
import { FAILURE_TYPE_FLAGS, type TsgoClient } from "./tsgo-client.ts"

/**
 * Tier-1 transform-splice: the sentinel-unroll bridge.
 *
 * A transform inside a recursive cycle is structurally untypeable (the runtime
 * object carries only the operation function), so the structural skeleton emits
 * `unknown` there. Tier-1 recovers the REAL output type without reconstructing
 * types or positional paths: `recursive()` exposes the user's generic builder as
 * `schema.build`, so ONE checker query —
 *
 *   `InferOutput<ReturnType<typeof X.build<BaseSchema<Sentinel_i, Sentinel_i>>>>`
 *
 * — makes tsgo compute the entire ONE-LEVEL-UNROLLED output type (every transform/
 * brand output composed in tsgo's own lexical context) with each self position
 * rendered as a distinctive sentinel alias. Substituting the sentinel token with
 * the declared alias name yields the recursive type, sound by construction: the
 * sentinel stood exactly at the self positions because it WAS the builder's type
 * argument. The query is pure type position (identifier + property access +
 * explicit type arguments) — no call expression, so `typeof` accepts it.
 *
 * Everything here fails CLOSED: any guard tripping returns a failure and the
 * caller keeps the Tier-2 skeleton. The fixpoint oracle and the data-property
 * cross-check (verify-splice.ts) gate the result before it is ever emitted.
 */

export interface SentinelTarget {
  /** The export binding name (the `typeof` target in the query). */
  readonly exportName: string
  /** The declared alias name the back-edge must render as. */
  readonly typeName: string
}

/**
 * Builds the unroll query body: one unique-symbol sentinel and one `__P`-flattened
 * marker per target. `__P` flattens intersections/mapped types exactly like the
 * plain resolver's query so both paths render comparably.
 */
export function buildSentinelQuery(
  sourceImportPath: string,
  targets: ReadonlyArray<SentinelTarget>,
): { body: string; markers: ReadonlyArray<string> } {
  const names = targets.map((t) => t.exportName)
  const markers = targets.map((_, i) => `__tskm_${i}`)
  const lines: string[] = []
  if (names.length > 0) {
    lines.push(`import { ${names.join(", ")} } from "${sourceImportPath}"`)
  }
  lines.push(`import type { BaseSchema, InferOutput } from "@tskm/core"`)
  lines.push("type __P<T> = { [K in keyof T]: T[K] } & {}")
  targets.forEach((target, i) => {
    lines.push(`declare const SENTINEL_${i}: unique symbol`)
    lines.push(`type Sentinel_${i} = { readonly [SENTINEL_${i}]: "__TskmSentinel_${i}__" }`)
    lines.push(
      `declare const ${markers[i]}: __P<InferOutput<ReturnType<typeof ${target.exportName}.build<BaseSchema<Sentinel_${i}, Sentinel_${i}>>>>>`,
    )
  })
  return { body: `${lines.join("\n")}\n`, markers }
}

export interface SentinelSubstitution {
  readonly typeString?: string
  readonly failure?: string
}

/**
 * Replaces the sentinel token with the alias name (whole word, never inside a
 * string literal) and verifies no sentinel artifact survives. `selfReferential`
 * tells the guard whether the sentinel MUST appear: a self-cycling root whose
 * unroll carries no sentinel means the recursion vanished in the checker (e.g. a
 * monomorphic builder collapsed to `{}`) — fail closed rather than emit a wrong,
 * non-recursive type.
 */
export function substituteSentinel(
  raw: string,
  index: number,
  alias: string,
  selfReferential: boolean,
): SentinelSubstitution {
  const token = `Sentinel_${index}`
  const { result, replaced } = replaceTokenOutsideQuotes(raw, token, alias)
  if (hasSentinelArtifacts(result)) {
    return {
      failure: "sentinel artifacts remain in the unrolled type after substitution",
    }
  }
  if (selfReferential && replaced === 0) {
    return {
      failure: `the unroll carries no ${token} sentinel although the schema is self-referential (recursion vanished in the checker)`,
    }
  }
  return { typeString: result }
}

/**
 * True when any sentinel residue survives: a `Sentinel_<n>`/`SENTINEL_<n>`
 * identifier outside string literals (a foreign or unsubstituted sentinel), or the
 * `__TskmSentinel_` marker text anywhere (the unique-symbol type was expanded
 * instead of kept as its alias). Either way the text is not a clean user type.
 */
function hasSentinelArtifacts(text: string): boolean {
  if (text.includes("__TskmSentinel_")) {
    return true
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch
      i++
      while (i < text.length) {
        const c = text[i] as string
        i++
        if (c === "\\" && i < text.length) {
          i++
          continue
        }
        if (c === quote) {
          break
        }
      }
      continue
    }
    const rest = text.slice(i)
    const match = /^(?:Sentinel|SENTINEL)_\d+/.exec(rest)
    if (match && !/[A-Za-z0-9_$]/.test(text[i - 1] ?? "")) {
      return true
    }
    i++
  }
  return false
}

/** The Tier-1 query file: a sibling with the excluded `.tskm-query.ts` suffix. */
export function sentinelQueryPath(sourceFileAbs: string): string {
  const dir = dirname(sourceFileAbs)
  const base = basename(sourceFileAbs, extname(sourceFileAbs))
  return join(dir, `${base}.tier1.tskm-query.ts`)
}

function sourceImportSpecifier(sourceFileAbs: string): string {
  const base = basename(sourceFileAbs, extname(sourceFileAbs))
  return `./${base}`
}

export interface SentinelUnrollResult {
  /** Raw unrolled type text per target index (present only on success). */
  readonly unrolled: ReadonlyMap<number, string>
  readonly diagnostics: ReadonlyArray<string>
}

/**
 * Resolves the one-level unroll for each target through the live tsgo client,
 * mirroring the plain resolver's query-file discipline (sibling file, anchored
 * offsets, R6 failure-flag guard, cleanup in `finally`).
 */
export function resolveSentinelUnroll(
  client: TsgoClient,
  sourceFileAbs: string,
  targets: ReadonlyArray<SentinelTarget>,
): SentinelUnrollResult {
  if (targets.length === 0) {
    return { unrolled: new Map(), diagnostics: [] }
  }
  const queryFile = sentinelQueryPath(sourceFileAbs)
  const { body, markers } = buildSentinelQuery(sourceImportSpecifier(sourceFileAbs), targets)

  const unrolled = new Map<number, string>()
  const diagnostics: string[] = []
  try {
    writeFileSync(queryFile, body)
    client.updateFile(queryFile, "created")

    targets.forEach((target, i) => {
      const marker = markers[i]
      if (!marker) {
        return
      }
      const anchor = `declare const ${marker}`
      const position = body.indexOf(anchor) + "declare const ".length
      const result = client.resolveTypeAt(queryFile, position)
      if (!result || result.flags & FAILURE_TYPE_FLAGS) {
        const flags = result ? `flags=${result.flags}` : "no type"
        diagnostics.push(
          `tskm: Tier-1 unroll for "${target.exportName}" did not resolve (${flags}); keeping the structural skeleton for ${target.typeName}.`,
        )
        return
      }
      unrolled.set(i, result.text)
    })
  } finally {
    rmSync(queryFile, { force: true })
    client.updateFile(queryFile, "deleted")
  }
  return { unrolled, diagnostics }
}
