import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import type { DiscoveredSchema } from "./discovery.ts"
import { reindentType } from "./emit.ts"
import type { ResolvedSchema } from "./resolve.ts"

/**
 * Experimental in-place emit.
 *
 * Instead of a sidecar `*.gen.ts`, the resolved concrete type is written back into
 * the source file, fenced between sentinel line-comments:
 *
 * ```ts
 * // @tskm-gen User from userSchema #a1b2c3d4
 * export type User = {
 *   name: string;
 * }
 * // @tskm-end User
 * ```
 *
 * The `#<hash8>` is a content hash of [resolved type body + generator/tsgo version +
 * source schema identity]; on a re-run a matching hash means the region is left byte
 * for byte unchanged (idempotent, mtime-stable). On the first run an
 * `export type User = Infer<typeof userSchema>` marker is converted to the fenced form.
 *
 * Limitations: only SINGLE-LINE `Infer` markers are recognized, and any trailing
 * content on that line (e.g. `= Infer<typeof X> // note`) is dropped on conversion.
 * CRLF and LF sources are both handled; emitted blocks adopt the file's dominant EOL.
 */

export interface InplaceTarget {
  readonly typeName: string
  readonly schemaName: string
}

export interface InplaceEmitResult {
  readonly source: string
  /** True if the file content changed (false when every region's hash matched). */
  readonly changed: boolean
  readonly content: string
  readonly typeNames: ReadonlyArray<string>
  readonly diagnostics: ReadonlyArray<string>
}

export interface EmitInplaceOptions {
  readonly pretty?: boolean
  /**
   * Version stamp folded into the content hash so a generator/tsgo upgrade
   * invalidates previously emitted regions.
   */
  readonly version?: string
}

// Sentinels live at column 0; `m` makes `^`/`$` match per line. Capture groups are
// (typeName, schemaName, hash8) for the start and (typeName) for the end.
const START_LINE = /^\/\/ @tskm-gen (\w+) from (\w+) #([0-9a-f]{8})$/
const END_LINE = /^\/\/ @tskm-end (\w+)$/

// First-run marker: only the SINGLE-LINE form is supported. Accepts the bare
// `Infer`/`InferOutput` reference and the `import("tskm").Infer*<...>` form — matching
// discovery's alias set. (`InferInput` is intentionally excluded: the resolver always
// queries `InferOutput`, so an input marker would be silently filled with the output type.)
const INFER_MARKER =
  /^(?:export\s+)?type (\w+)\s*=\s*(?:import\([^)]*\)\.)?(?:Infer|InferOutput)\s*<\s*typeof\s+(\w+)\s*>[^\n]*$/

/**
 * Folds the raw (single-line) `typeString` together with the version stamp and the
 * schema/type identity into a stable 8-hex content hash. The raw string is hashed —
 * pretty-printing is a deterministic function of it, so it carries no extra entropy.
 */
function contentHash(
  typeString: string,
  version: string,
  schemaName: string,
  typeName: string,
): string {
  const payload = `${typeString}\n${version}\n${schemaName}\n${typeName}`
  return createHash("sha256").update(payload).digest("hex").slice(0, 8)
}

/** The file's dominant end-of-line, so emitted blocks don't mix CRLF and LF. */
function dominantEol(sourceText: string): string {
  return sourceText.includes("\r\n") ? "\r\n" : "\n"
}

function renderRegion(
  typeName: string,
  schemaName: string,
  hash8: string,
  typeString: string,
  pretty: boolean,
  eol: string,
): string {
  const value = pretty ? reindentType(typeString) : typeString
  const body = eol === "\r\n" ? value.replaceAll("\n", "\r\n") : value
  return [
    `// @tskm-gen ${typeName} from ${schemaName} #${hash8}`,
    `export type ${typeName} = ${body}`,
    `// @tskm-end ${typeName}`,
  ].join(eol)
}

interface SentinelRegion {
  readonly typeName: string
  readonly schemaName: string
  readonly hash8: string
  /** Index of the first char of the start sentinel line. */
  readonly start: number
  /** Index one past the last char of the end sentinel line. */
  readonly end: number
}

interface ScanResult {
  readonly regions: ReadonlyArray<SentinelRegion>
  readonly diagnostics: ReadonlyArray<string>
  /** True when a structural problem means the file must not be rewritten. */
  readonly corrupt: boolean
}

/**
 * Line-by-line scan for sentinel regions with strict structural validation. Reports
 * (and refuses) any half-open region, name mismatch, nesting, or duplicate typeName —
 * the source is never silently rewritten when it looks malformed.
 */
function scanSentinels(sourceText: string): ScanResult {
  const regions: SentinelRegion[] = []
  const diagnostics: string[] = []
  const seen = new Set<string>()
  let corrupt = false

  let offset = 0
  let open: { match: SentinelRegion } | null = null

  for (const rawLine of sourceText.split("\n")) {
    const lineStart = offset
    // +1 for the "\n" consumed by split; harmless for the final line.
    offset += rawLine.length + 1
    // Tolerate CRLF: strip a trailing "\r" so the `$`-anchored regexes still match and
    // so the region offsets exclude the carriage return.
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine

    const startMatch = START_LINE.exec(line)
    if (startMatch) {
      if (open) {
        diagnostics.push(
          `tskm: nested @tskm-gen for "${startMatch[1]}" inside region "${open.match.typeName}"; skipping.`,
        )
        corrupt = true
        continue
      }
      const [, typeName, schemaName, hash8] = startMatch
      if (!typeName || !schemaName || !hash8) {
        continue
      }
      open = {
        match: { typeName, schemaName, hash8, start: lineStart, end: lineStart },
      }
      continue
    }

    const endMatch = END_LINE.exec(line)
    if (endMatch) {
      const endName = endMatch[1]
      if (!endName) {
        continue
      }
      if (!open) {
        diagnostics.push(`tskm: @tskm-end ${endName} without a matching @tskm-gen; skipping.`)
        corrupt = true
        continue
      }
      if (open.match.typeName !== endName) {
        diagnostics.push(
          `tskm: @tskm-end ${endName} does not match open region "${open.match.typeName}"; skipping.`,
        )
        corrupt = true
        open = null
        continue
      }
      if (seen.has(endName)) {
        diagnostics.push(`tskm: duplicate sentinel region for type "${endName}"; skipping.`)
        corrupt = true
        open = null
        continue
      }
      seen.add(endName)
      regions.push({ ...open.match, end: lineStart + line.length })
      open = null
    }
  }

  if (open) {
    diagnostics.push(`tskm: @tskm-gen ${open.match.typeName} has no matching @tskm-end; skipping.`)
    corrupt = true
  }

  return { regions, diagnostics, corrupt }
}

/**
 * Merges the inplace targets to resolve for a source file: `Infer<typeof X>` aliases
 * (first run) unioned with already-emitted sentinel regions (re-runs), deduped by
 * type name. The returned `DiscoveredSchema[]` feeds the normal tsgo resolve step.
 */
export function collectInplaceTargets(
  sourceText: string,
  aliases: ReadonlyArray<DiscoveredSchema>,
): { targets: ReadonlyArray<DiscoveredSchema>; diagnostics: ReadonlyArray<string> } {
  const scan = scanSentinels(sourceText)

  const targets: DiscoveredSchema[] = []
  const seen = new Set<string>()
  for (const alias of aliases) {
    if (seen.has(alias.typeName)) {
      continue
    }
    seen.add(alias.typeName)
    targets.push(alias)
  }
  for (const region of scan.regions) {
    if (seen.has(region.typeName)) {
      continue
    }
    seen.add(region.typeName)
    targets.push({ name: region.schemaName, typeName: region.typeName, origin: "alias" })
  }

  return { targets, diagnostics: scan.diagnostics }
}

interface LocatedRegion {
  readonly typeName: string
  readonly schemaName: string
  readonly start: number
  readonly end: number
  /** Existing region hash, or undefined for a first-run `Infer` marker. */
  readonly existingHash?: string
}

/**
 * Finds the single-line `Infer` markers in the source, deduped by typeName against
 * already-located sentinel regions (a sentinel always wins). Each match maps a
 * typeName to its source-schema name and the span of the line to replace.
 */
function locateInferMarkers(sourceText: string, taken: ReadonlySet<string>): LocatedRegion[] {
  const located: LocatedRegion[] = []
  let offset = 0
  for (const rawLine of sourceText.split("\n")) {
    const lineStart = offset
    offset += rawLine.length + 1
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    const m = INFER_MARKER.exec(line)
    if (!m) {
      continue
    }
    const [, typeName, schemaName] = m
    if (!typeName || !schemaName || taken.has(typeName)) {
      continue
    }
    located.push({ typeName, schemaName, start: lineStart, end: lineStart + line.length })
  }
  return located
}

/**
 * Rewrites `sourceText` in place: for each resolved type (matched by `typeName`)
 * replaces its `Infer` alias / existing sentinel region with the concrete type
 * fenced by sentinels, skipping regions whose content hash is unchanged.
 */
export function emitInplace(
  sourceFileAbs: string,
  sourceText: string,
  resolved: ReadonlyArray<ResolvedSchema>,
  options: EmitInplaceOptions = {},
): InplaceEmitResult {
  const pretty = options.pretty ?? true
  const version = options.version ?? ""
  const eol = dominantEol(sourceText)

  const scan = scanSentinels(sourceText)
  const diagnostics: string[] = [...scan.diagnostics]

  // A structurally broken file is never rewritten; surface the diagnostics instead.
  if (scan.corrupt) {
    return {
      source: sourceFileAbs,
      changed: false,
      content: sourceText,
      typeNames: [],
      diagnostics,
    }
  }

  const sentinelByType = new Map<string, SentinelRegion>()
  for (const region of scan.regions) {
    sentinelByType.set(region.typeName, region)
  }

  const inferMarkers = locateInferMarkers(sourceText, new Set(sentinelByType.keys()))
  const markerByType = new Map<string, LocatedRegion>()
  for (const marker of inferMarkers) {
    // First single-line marker per typeName wins; ignore accidental duplicates.
    if (!markerByType.has(marker.typeName)) {
      markerByType.set(marker.typeName, marker)
    }
  }

  interface Replacement {
    readonly start: number
    readonly end: number
    readonly text: string
    readonly unchanged: boolean
  }
  const replacements: Replacement[] = []
  const typeNames: string[] = []
  const handledResolved = new Set<string>()

  for (const r of resolved) {
    if (handledResolved.has(r.typeName)) {
      diagnostics.push(
        `tskm: duplicate resolved type "${r.typeName}" for inplace emit; skipping the extra.`,
      )
      continue
    }
    handledResolved.add(r.typeName)

    const sentinel = sentinelByType.get(r.typeName)
    const marker = markerByType.get(r.typeName)
    const located = sentinel ?? marker
    if (!located) {
      diagnostics.push(
        `tskm: no @tskm-gen region or Infer marker for "${r.typeName}"; skipping (source left intact).`,
      )
      continue
    }

    const schemaName = located.schemaName
    const hash8 = contentHash(r.typeString, version, schemaName, r.typeName)

    if (sentinel && sentinel.hash8 === hash8) {
      // Idempotent: leave the existing region byte-for-byte unchanged.
      typeNames.push(r.typeName)
      replacements.push({ start: located.start, end: located.end, text: "", unchanged: true })
      continue
    }

    const text = renderRegion(r.typeName, schemaName, hash8, r.typeString, pretty, eol)
    replacements.push({ start: located.start, end: located.end, text, unchanged: false })
    typeNames.push(r.typeName)
  }

  const anyChange = replacements.some((r) => !r.unchanged)
  if (!anyChange) {
    // Every located region matched its hash (or nothing was located): the file is
    // already current — do not rewrite, so the mtime stays stable.
    return {
      source: sourceFileAbs,
      changed: false,
      content: sourceText,
      typeNames,
      diagnostics,
    }
  }

  // Apply replacements left-to-right; spans never overlap (sentinel regions are
  // validated non-nesting and Infer markers are skipped when a sentinel exists).
  const applied = replacements.filter((r) => !r.unchanged).sort((a, b) => a.start - b.start)

  let content = ""
  let cursor = 0
  for (const r of applied) {
    content += sourceText.slice(cursor, r.start) + r.text
    cursor = r.end
  }
  content += sourceText.slice(cursor)

  writeFileSync(sourceFileAbs, content)

  return {
    source: sourceFileAbs,
    changed: true,
    content,
    typeNames,
    diagnostics,
  }
}
