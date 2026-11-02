import { mkdirSync, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import * as esbuild from "esbuild"
import type { LibraryName } from "./config.ts"
import { validPayload } from "./payload.ts"

export interface BundleRow {
  readonly library: LibraryName
  readonly bytes: number
  readonly gzipBytes: number
}

function entrySource(name: LibraryName): string {
  return [
    `import { parse } from "../src/libs/${name}.ts"`,
    `const payload = ${JSON.stringify(validPayload)}`,
    "if (!parse(payload)) throw new Error('invalid')",
    "",
  ].join("\n")
}

export async function measureBundle(name: LibraryName): Promise<BundleRow> {
  const directory = new URL("../bundle-out/", import.meta.url)
  mkdirSync(directory, { recursive: true })
  const entry = new URL(`entry-${name}.ts`, directory)
  writeFileSync(entry, entrySource(name))
  const built = await esbuild.build({
    absWorkingDir: new URL("..", import.meta.url).pathname,
    entryPoints: [entry.pathname],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "neutral",
    treeShaking: true,
    write: false,
    legalComments: "none",
  })
  const file = built.outputFiles[0]
  if (!file) throw new Error(`${name} bundle was empty`)
  return {
    library: name,
    bytes: file.contents.byteLength,
    gzipBytes: gzipSync(file.contents, { level: 9 }).byteLength,
  }
}
