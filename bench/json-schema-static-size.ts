import { existsSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"
import * as esbuild from "esbuild"

/**
 * esbuild minify + gzip of the runtime walker path versus the static path.
 * The static entry imports only `withStaticJsonSchema`. It must not contain the
 * walker in `src/json-schema/convert.ts`.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const coreSrc = join(repoRoot, "packages/tskm/src")
const coreDist = join(repoRoot, "packages/tskm/dist")

/** Strings that exist only in the runtime walker. */
export const CONVERT_MARKERS = [
  "not reified at runtime",
  "propertyNames is not part of OpenAPI",
  "cannot represent a default value in JSON Schema",
] as const

export interface BundleMeasure {
  readonly label: string
  readonly minifyBytes: number
  readonly gzipBytes: number
  readonly containsConvert: boolean
}

const schemaLiteral = `{
  "draft-2020-12": {
    input: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    output: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false }
  },
  "draft-07": {
    input: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    output: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false }
  },
  "openapi-3.0": {
    input: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    output: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false }
  }
}`

function entrySource(kind: "static" | "runtime", jsonSchema: string, core: string): string {
  if (kind === "static") {
    return `import { withStaticJsonSchema } from ${JSON.stringify(jsonSchema)}
import { object, string } from ${JSON.stringify(core)}
const docs = ${schemaLiteral}
export const user = withStaticJsonSchema(object({ name: string() }), docs)
`
  }
  return `import { withJsonSchema } from ${JSON.stringify(jsonSchema)}
import { object, string } from ${JSON.stringify(core)}
export const user = withJsonSchema(object({ name: string() }))
`
}

async function bundle(contents: string, resolveDir: string): Promise<Uint8Array> {
  const result = await esbuild.build({
    stdin: {
      contents,
      resolveDir,
      sourcefile: "entry.ts",
      loader: "ts",
    },
    bundle: true,
    minify: true,
    format: "esm",
    platform: "neutral",
    write: false,
    logLevel: "silent",
  })
  const file = result.outputFiles[0]
  if (file === undefined) {
    throw new Error("esbuild produced no output")
  }
  return file.contents
}

function containsConvert(code: string): boolean {
  return CONVERT_MARKERS.some((marker) => code.includes(marker))
}

export async function measureBundle(
  label: string,
  kind: "static" | "runtime",
  resolveDir: string,
  jsonSchema: string,
  core: string,
): Promise<BundleMeasure> {
  const bytes = await bundle(entrySource(kind, jsonSchema, core), resolveDir)
  const code = new TextDecoder().decode(bytes)
  return {
    label,
    minifyBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes).byteLength,
    containsConvert: containsConvert(code),
  }
}

export async function measureStaticJsonSchemaBundles(): Promise<ReadonlyArray<BundleMeasure>> {
  const rows: BundleMeasure[] = [
    await measureBundle("source static", "static", coreSrc, "./json-schema.ts", "./index.ts"),
    await measureBundle("source runtime", "runtime", coreSrc, "./json-schema.ts", "./index.ts"),
  ]
  if (existsSync(join(coreDist, "json-schema.mjs")) && existsSync(join(coreDist, "index.mjs"))) {
    rows.push(
      await measureBundle("dist static", "static", coreDist, "./json-schema.mjs", "./index.mjs"),
      await measureBundle("dist runtime", "runtime", coreDist, "./json-schema.mjs", "./index.mjs"),
    )
  }
  return rows
}

export function renderSizeReport(rows: ReadonlyArray<BundleMeasure>): string {
  const sourceStatic = rows.find((row) => row.label === "source static")
  const sourceRuntime = rows.find((row) => row.label === "source runtime")
  const delta =
    sourceStatic !== undefined && sourceRuntime !== undefined
      ? sourceRuntime.gzipBytes - sourceStatic.gzipBytes
      : undefined
  const lines = [
    "# Static JSON Schema bundle",
    "",
    "esbuild minify + gzip. The static entry imports `withStaticJsonSchema` and a small",
    "schema. The runtime entry imports `withJsonSchema` and the same schema. Gzip sizes",
    "are the compressed bundle, marker check included.",
    "",
    "| entry | minify bytes | gzip bytes | contains `convert.ts` |",
    "| --- | ---: | ---: | --- |",
    ...rows.map(
      (row) =>
        `| ${row.label} | ${row.minifyBytes} | ${row.gzipBytes} | ${row.containsConvert ? "yes" : "no"} |`,
    ),
    "",
  ]
  if (delta !== undefined) {
    lines.push(`Source gzip delta (runtime − static): ${delta} bytes.`, "")
  }
  lines.push(
    "The static bundle must not contain `src/json-schema/convert.ts`. The check looks for",
    "`not reified at runtime`, `propertyNames is not part of OpenAPI`, and",
    "`cannot represent a default value in JSON Schema`, which that file emits and the",
    "static helper does not.",
    "",
    "Regenerate with `bun bench/json-schema-static-size.ts`.",
    "",
  )
  return lines.join("\n")
}

const isDirectRun =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirectRun) {
  const rows = await measureStaticJsonSchemaBundles()
  const report = renderSizeReport(rows)
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "json-schema-static.md"), report)
  process.stdout.write(report)
}
