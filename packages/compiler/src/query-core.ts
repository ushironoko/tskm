import { rmSync, writeFileSync } from "node:fs"
import { basename, extname } from "node:path"
import type { TsgoClient } from "./tsgo-client.ts"

/**
 * Shared infrastructure for checker query files. The plain resolver
 * (resolve.ts), the Tier-1 sentinel unroll (tier1.ts) and the fixpoint oracle
 * (verify-splice.ts) all follow the same discipline — sibling `.tskm-query.ts`
 * file, `__P` prettify helper, anchored marker offsets, cleanup in `finally` —
 * so the building blocks live here exactly once.
 */

/**
 * The prettify helper declared in every query body: flattens intersections and
 * mapped types so rendered output is clean. NOTE: applied to a top-level named
 * class (Date/Map/Set) or branded primitive it expands the whole prototype —
 * callers pair it with a raw (unwrapped) marker and choose per result.
 */
export const PRETTIFY_DECL = "type __P<T> = { [K in keyof T]: T[K] } & {}"

/** Prefix of generated marker identifiers in query files. */
export const MARKER_PREFIX = "__tskm_"

/**
 * The import specifier from a query file back to the source module. Query files
 * are siblings of the source, so a relative `./<base>` (no extension) resolves.
 */
export function sourceImportSpecifier(sourceFileAbs: string): string {
  const base = basename(sourceFileAbs, extname(sourceFileAbs))
  return `./${base}`
}

/**
 * The checker offset of a `declare const <marker>` anchor: the identifier
 * position right after `declare const `. Query bodies are self-generated ASCII,
 * so a string index IS the checker position (no UTF-16 drift).
 */
export function markerPosition(body: string, marker: string): number {
  return body.indexOf(`declare const ${marker}`) + "declare const ".length
}

/**
 * Runs `fn` with `body` written to `queryFileAbs` and registered with the
 * checker; always cleans up (file delete + checker notification), so the user's
 * project never keeps a stray query artifact, whatever `fn` does.
 */
export function withQueryFile<T>(
  client: TsgoClient,
  queryFileAbs: string,
  body: string,
  fn: () => T,
): T {
  try {
    writeFileSync(queryFileAbs, body)
    client.updateFile(queryFileAbs, "created")
    return fn()
  } finally {
    rmSync(queryFileAbs, { force: true })
    client.updateFile(queryFileAbs, "deleted")
  }
}
