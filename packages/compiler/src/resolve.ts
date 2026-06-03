import { rmSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import type { DiscoveredSchema } from "./discovery.ts"
import { FAILURE_TYPE_FLAGS, type TsgoClient } from "./tsgo-client.ts"

export interface ResolvedSchema {
  readonly typeName: string
  readonly typeString: string
}

export interface ResolveResult {
  readonly resolved: ReadonlyArray<ResolvedSchema>
  readonly diagnostics: ReadonlyArray<string>
}

const MARKER_PREFIX = "__tskm_"

/**
 * Builds the query file body: imports each schema from the source module, then
 * declares a prettified marker per schema whose checker type is the schema's
 * inferred output. `__P` flattens intersections/mapped types for clean output.
 */
function buildQueryBody(
  sourceImportPath: string,
  schemas: ReadonlyArray<DiscoveredSchema>,
): { body: string; markers: ReadonlyArray<string> } {
  const names = schemas.map((s) => s.name)
  const markers = schemas.map((_, i) => `${MARKER_PREFIX}${i}`)
  const lines: string[] = []
  if (names.length > 0) {
    lines.push(`import { ${names.join(", ")} } from "${sourceImportPath}"`)
  }
  lines.push(`import type { InferOutput } from "@tskm/core"`)
  lines.push(`type __P<T> = { [K in keyof T]: T[K] } & {}`)
  schemas.forEach((schema, i) => {
    lines.push(`declare const ${markers[i]}: __P<InferOutput<typeof ${schema.name}>>`)
  })
  return { body: `${lines.join("\n")}\n`, markers }
}

/**
 * The import specifier from the query file back to the source module. The query
 * file is a sibling of the source, so a relative `./<base>` (no extension) resolves.
 */
function sourceImportSpecifier(sourceFileAbs: string): string {
  const base = basename(sourceFileAbs, extname(sourceFileAbs))
  return `./${base}`
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
 * The query file is always cleaned up.
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

  try {
    writeFileSync(queryFile, body)
    client.updateFile(queryFile, "created")

    schemas.forEach((schema, i) => {
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
          `tskm: could not resolve a concrete type for "${schema.name}" (${flags}); skipping ${schema.typeName}. Existing output left untouched.`,
        )
        return
      }
      resolved.push({ typeName: schema.typeName, typeString: result.text })
    })
  } finally {
    rmSync(queryFile, { force: true })
    client.updateFile(queryFile, "deleted")
  }

  return { resolved, diagnostics }
}
