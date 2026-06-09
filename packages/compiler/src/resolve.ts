import { basename, dirname, extname, join } from "node:path"
import type { DiscoveredSchema } from "./discovery.ts"
import {
  MARKER_PREFIX,
  markerPosition,
  PRETTIFY_DECL,
  sourceImportSpecifier,
  withQueryFile,
} from "./query-core.ts"
import { referencesTypeOutsideQuotes } from "./token-scan.ts"
import { FAILURE_TYPE_FLAGS, type ResolvedType, type TsgoClient } from "./tsgo-client.ts"

export interface ResolvedSchema {
  readonly typeName: string
  readonly typeString: string
  /** The source export binding the type came from (the `typeof` target). */
  readonly sourceName?: string
  /** Vendor of the originating schema source (`"zod"`…); absent = tskm. */
  readonly vendorHint?: string
  /** The discovery-captured self-annotation (external recursion; see discovery.ts). */
  readonly recursiveAnnotation?: {
    readonly name: string
    readonly exported: boolean
    readonly exportedAs?: string
  }
}

export interface ResolveResult {
  readonly resolved: ReadonlyArray<ResolvedSchema>
  readonly diagnostics: ReadonlyArray<string>
}

/**
 * The Standard Schema output-type query for one schema binding. Structural
 * access only — no type import — so the same expression resolves tskm, zod,
 * valibot and arktype schemas alike (every Standard Schema carries its inferred
 * types on `~standard.types`; the spec leaves the property optional, hence the
 * `NonNullable`).
 */
function standardOutputExpr(name: string): string {
  return `NonNullable<(typeof ${name})["~standard"]["types"]>["output"]`
}

/**
 * Picks the rendered type text: the `__P`-prettified form for a top-level object
 * (flattens intersections/mapped types; byte-identical to raw for plain
 * objects), the raw form for everything else — `__P` applied to a top-level
 * named class (Date/Map/Set) or branded primitive expands the entire prototype.
 * A failed pretty marker always falls back to raw.
 */
export function chooseRendering(raw: ResolvedType, pretty: ResolvedType | null): string {
  if (!pretty || pretty.flags & FAILURE_TYPE_FLAGS) {
    return raw.text
  }
  return raw.text.trimStart().startsWith("{") ? pretty.text : raw.text
}

/**
 * The candidate-confirmation probe. The `0 extends 1 & T` prefix is the
 * any-guard (spike-verified): without it an `any` export distributes to
 * `boolean`, and a tuple-wrapped check is a false-positive `true`. Only the
 * literal `true` confirms a candidate.
 */
const GUARD_DECL =
  'type __G<T> = 0 extends 1 & T ? false : T extends { "~standard": { version: number; vendor: string } } ? true : false'

interface SchemaMarkers {
  readonly raw: string
  readonly pretty: string
  /** Present only for `candidate` schemas (external sources awaiting confirmation). */
  readonly guard?: string
}

/**
 * Builds the query file body: imports each schema from the source module, then
 * declares TWO markers per schema — the raw `~standard` output and its
 * `__P`-prettified form — so the resolver can pick per result (see
 * {@link chooseRendering}).
 */
function buildQueryBody(
  sourceImportPath: string,
  schemas: ReadonlyArray<DiscoveredSchema>,
): { body: string; markers: ReadonlyArray<SchemaMarkers> } {
  const names = schemas.map((s) => s.name)
  const markers = schemas.map((s, i) => ({
    raw: `${MARKER_PREFIX}raw_${i}`,
    pretty: `${MARKER_PREFIX}pp_${i}`,
    ...(s.capability.confidence === "candidate" ? { guard: `${MARKER_PREFIX}g_${i}` } : {}),
  }))
  const lines: string[] = []
  if (names.length > 0) {
    lines.push(`import { ${names.join(", ")} } from "${sourceImportPath}"`)
  }
  lines.push(PRETTIFY_DECL)
  if (markers.some((m) => m.guard)) {
    lines.push(GUARD_DECL)
  }
  schemas.forEach((schema, i) => {
    const marker = markers[i]
    if (!marker) {
      return
    }
    const expr = standardOutputExpr(schema.name)
    if (marker.guard) {
      lines.push(`declare const ${marker.guard}: __G<typeof ${schema.name}>`)
    }
    lines.push(`declare const ${marker.raw}: ${expr}`)
    lines.push(`declare const ${marker.pretty}: __P<${expr}>`)
  })
  return { body: `${lines.join("\n")}\n`, markers }
}

/**
 * The query file path: a sibling of the source file. It must NOT live in a
 * dot-prefixed directory — tsgo excludes dotfiles/dot-dirs from the project, so a
 * `.tskm/` subdir would make the file invisible to the checker. A distinctive
 * suffix avoids colliding with user sources while keeping it next to the original.
 */
export function queryFilePath(sourceFileAbs: string): string {
  const dir = dirname(sourceFileAbs)
  const base = basename(sourceFileAbs, extname(sourceFileAbs))
  return join(dir, `${base}.tskm-query.ts`)
}

/**
 * Writes a query file next to the source, resolves each schema's inferred output
 * type via tsgo, and applies the R6 guard (Any/Unknown/Never => resolution failure,
 * skipped with a diagnostic so existing output is never overwritten with garbage).
 * The raw marker is resolved first; the pretty marker only when the raw text
 * looks like a top-level object (the only form `__P` improves). The query file is
 * always cleaned up.
 */
export function resolveSchemas(
  client: TsgoClient,
  sourceFileAbs: string,
  schemas: ReadonlyArray<DiscoveredSchema>,
): ResolveResult {
  if (schemas.length === 0) {
    return { resolved: [], diagnostics: [] }
  }

  const queryFile = queryFilePath(sourceFileAbs)
  const { body, markers } = buildQueryBody(sourceImportSpecifier(sourceFileAbs), schemas)

  const resolved: ResolvedSchema[] = []
  const diagnostics: string[] = []
  /** vendor -> [candidates seen, candidates confirmed], for the version-skew hint. */
  const vendorTallies = new Map<string, { seen: number; confirmed: number }>()
  const tally = (vendor: string | undefined, confirmed: boolean): void => {
    if (!vendor) {
      return
    }
    const entry = vendorTallies.get(vendor) ?? { seen: 0, confirmed: 0 }
    entry.seen += 1
    if (confirmed) {
      entry.confirmed += 1
    }
    vendorTallies.set(vendor, entry)
  }

  withQueryFile(client, queryFile, body, () => {
    // One snapshot serves every marker of this query file: the file state is fixed
    // for the whole loop, so reusing a single snapshot avoids a fresh (dominant-cost)
    // snapshot per marker. Same checker queries, same results, one snapshot lifecycle.
    client.withSnapshot((resolveAt) => {
      schemas.forEach((schema, i) => {
        const marker = markers[i]
        if (!marker) {
          return
        }
        // Guard FIRST: a candidate whose probe is not the literal `true` is not a
        // Standard Schema (or is `any`) — drop it silently, raw/pretty unresolved.
        // It carried no user intent (auto-collected), so no diagnostic either.
        if (marker.guard) {
          const verdict = resolveAt(queryFile, markerPosition(body, marker.guard))
          const confirmed = verdict?.text === "true"
          tally(schema.capability.vendorHint, confirmed)
          if (!confirmed) {
            return
          }
        }
        const raw = resolveAt(queryFile, markerPosition(body, marker.raw))

        if (!raw || raw.flags & FAILURE_TYPE_FLAGS) {
          const flags = raw ? `flags=${raw.flags}` : "no type"
          // An external schema most commonly fails here when it is recursive
          // without the library-idiomatic self annotation — say so.
          const hint =
            schema.capability.sourceKind === "standard" && !schema.recursiveAnnotation
              ? " If the schema is recursive, add an explicit self type annotation (e.g. z.ZodType<T> / v.GenericSchema<T>)."
              : ""
          diagnostics.push(
            `tskm: could not resolve a concrete type for "${schema.name}" (${flags}); skipping ${schema.typeName}.${hint} Existing output left untouched.`,
          )
          return
        }

        // Only a top-level object benefits from __P; skip the second query otherwise.
        const pretty = raw.text.trimStart().startsWith("{")
          ? resolveAt(queryFile, markerPosition(body, marker.pretty))
          : null

        const typeString = chooseRendering(raw, pretty)

        // A rendered reference to a NON-exported annotation type can never compile
        // in the sidecar (TS2459) — fail closed with an actionable diagnostic.
        const annotation = schema.recursiveAnnotation
        if (
          annotation &&
          !annotation.exported &&
          referencesTypeOutsideQuotes(typeString, annotation.name)
        ) {
          diagnostics.push(
            `tskm: "${schema.name}" renders as a reference to type "${annotation.name}", which is not exported from the source module; export it (\`export type ${annotation.name} = ...\`) so the generated sidecar can import it. Skipping ${schema.typeName}. Existing output left untouched.`,
          )
          return
        }

        resolved.push({
          typeName: schema.typeName,
          typeString,
          sourceName: schema.name,
          vendorHint: schema.capability.vendorHint,
          ...(annotation ? { recursiveAnnotation: annotation } : {}),
        })
      })
    })
  })

  // Guard-rejection hint: a vendor whose candidates ALL failed the guard either
  // predates Standard Schema support, or its inference collapsed to `any` —
  // most commonly annotation-free recursion. (Zero noise when one confirmed.)
  for (const [vendor, { seen, confirmed }] of vendorTallies) {
    if (seen > 0 && confirmed === 0) {
      diagnostics.push(
        `tskm: no Standard Schema values found among the "${vendor}" exports of ${sourceFileAbs}; the installed library version may predate Standard Schema support (zod >=3.24, valibot >=1.0, arktype >=2.0), or a recursive schema may need an explicit self type annotation (z.ZodType<T> / v.GenericSchema<T>). No types generated for those exports.`,
      )
    }
  }

  return { resolved, diagnostics }
}
