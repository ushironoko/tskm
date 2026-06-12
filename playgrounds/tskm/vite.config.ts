import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath, URL } from "node:url"
import { generate } from "@tskm/compiler"
import react from "@vitejs/plugin-react"
import * as ts from "typescript"
import { defineConfig, type Plugin } from "vite"

const runtimeEntry = fileURLToPath(new URL("../../packages/tskm/src/index.ts", import.meta.url))
const typegenEndpoint = "/__tskm_playground/typegen"
const typecheckEndpoint = "/__tskm_playground/typecheck"

export default defineConfig({
  plugins: [react(), tskmPlaygroundTypegen()],
  resolve: {
    alias: {
      "@tskm/core": runtimeEntry,
    },
  },
})

function tskmPlaygroundTypegen(): Plugin {
  return {
    name: "tskm-playground-typegen",
    configureServer(server) {
      server.middlewares.use(typegenEndpoint, async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, message: "POST required" })
          return
        }

        try {
          const body = await readJsonBody(req)
          if (typeof body.schemaSource !== "string") {
            sendJson(res, 400, { ok: false, message: "schemaSource must be a string" })
            return
          }

          const result = await generatePlaygroundType(body.schemaSource)
          sendJson(res, 200, result)
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            diagnostics: [],
          })
        }
      })
      server.middlewares.use(typecheckEndpoint, async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, message: "POST required" })
          return
        }

        try {
          const body = await readJsonBody(req)
          if (typeof body.schemaSource !== "string" || typeof body.inputSource !== "string") {
            sendJson(res, 400, {
              ok: false,
              message: "schemaSource and inputSource must be strings",
            })
            return
          }

          const result = await typecheckPlaygroundInput(body.schemaSource, body.inputSource)
          sendJson(res, 200, result)
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            diagnostics: [],
          })
        }
      })
    },
  }
}

async function generatePlaygroundType(schemaSource: string) {
  const root = await mkdtemp(join(tmpdir(), "tskm-playground-typegen-"))
  try {
    const srcDir = join(root, "src")
    const sourceFile = join(srcDir, "playground.schema.ts")
    const sidecarFile = join(srcDir, "playground.schema.gen.ts")
    await mkdir(srcDir, { recursive: true })
    await writeFile(join(root, "tsconfig.json"), playgroundTsconfig(root))
    await writeFile(sourceFile, playgroundSource(schemaSource))

    const result = await generate({
      root,
      config: {
        include: ["src/**/*.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: process.execPath },
      },
      pretty: true,
    })

    const generated =
      result.files.find((file) => file.output === sidecarFile) ??
      result.files.find((file) => file.output.endsWith("/src/playground.schema.gen.ts")) ??
      result.files[0]
    if (!generated) {
      return {
        ok: false,
        message: "tskm gen did not emit a playground sidecar.",
        diagnostics: result.diagnostics,
      }
    }

    return {
      ok: true,
      content: await readFile(generated.output, "utf8"),
      diagnostics: result.diagnostics,
      typeNames: generated.typeNames,
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function typecheckPlaygroundInput(schemaSource: string, inputSource: string) {
  const root = await mkdtemp(join(tmpdir(), "tskm-playground-typecheck-"))
  try {
    const srcDir = join(root, "src")
    const sourceFile = join(srcDir, "playground.schema.ts")
    const inputFile = join(srcDir, "playground.input.ts")
    await mkdir(srcDir, { recursive: true })
    await writeFile(join(root, "tsconfig.json"), playgroundTsconfig(root))
    await writeFile(sourceFile, playgroundSource(schemaSource))

    const result = await generate({
      root,
      config: {
        include: ["src/**/*.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: process.execPath },
      },
      pretty: true,
    })

    const generated = result.files[0]
    if (!generated) {
      return {
        ok: false,
        message: "tskm gen did not emit a playground sidecar.",
        diagnostics: [],
        compilerDiagnostics: result.diagnostics,
      }
    }

    const inputPrefix = `import type { PlaygroundOutput } from "./playground.schema.gen"\n\nconst playgroundInput: PlaygroundOutput = `
    const inputSuffix = "\n"
    const inputText = `${inputPrefix}${inputSource}${inputSuffix}`
    await writeFile(inputFile, inputText)

    return {
      ok: true,
      diagnostics: collectTypecheckDiagnostics(
        root,
        inputFile,
        inputText,
        inputPrefix.length,
        inputSource,
      ),
      compilerDiagnostics: result.diagnostics,
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function collectTypecheckDiagnostics(
  root: string,
  inputFile: string,
  inputText: string,
  inputStart: number,
  inputSource: string,
) {
  const configPath = join(root, "tsconfig.json")
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const sourceFile = program.getSourceFile(inputFile)
  if (!sourceFile) return []

  const inputEnd = inputStart + inputSource.length
  return ts
    .getPreEmitDiagnostics(program, sourceFile)
    .filter((diagnostic) => diagnostic.file?.fileName === inputFile)
    .map((diagnostic) =>
      toEditorDiagnostic(diagnostic, sourceFile, inputText, inputSource, inputStart, inputEnd),
    )
}

function toEditorDiagnostic(
  diagnostic: ts.Diagnostic,
  sourceFile: ts.SourceFile,
  inputText: string,
  inputSource: string,
  inputStart: number,
  inputEnd: number,
) {
  const fallbackStart = firstNonWhitespaceOffset(inputSource)
  const rawStart = diagnostic.start ?? inputStart
  const rawEnd = rawStart + Math.max(diagnostic.length ?? 1, 1)
  const startOffset =
    rawStart >= inputStart && rawStart <= inputEnd ? rawStart - inputStart : fallbackStart
  const endOffset =
    rawEnd >= inputStart && rawEnd <= inputEnd
      ? Math.max(rawEnd - inputStart, startOffset + 1)
      : expandFallbackEnd(inputSource, startOffset)
  const start = offsetToPosition(inputSource, startOffset)
  const end = offsetToPosition(inputSource, Math.min(endOffset, inputSource.length))
  const sourcePosition =
    diagnostic.start === undefined
      ? undefined
      : sourceFile.getLineAndCharacterOfPosition(Math.min(diagnostic.start, inputText.length))

  return {
    code: diagnostic.code,
    category: ts.DiagnosticCategory[diagnostic.category].toLowerCase(),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    startOffset,
    endOffset: Math.min(endOffset, inputSource.length),
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    sourceLine: sourcePosition ? sourcePosition.line : undefined,
    sourceColumn: sourcePosition ? sourcePosition.character : undefined,
  }
}

function firstNonWhitespaceOffset(text: string): number {
  const match = /\S/.exec(text)
  return match?.index ?? 0
}

function expandFallbackEnd(text: string, startOffset: number): number {
  const lineEnd = text.indexOf("\n", startOffset)
  const end = lineEnd === -1 ? text.length : lineEnd
  return Math.max(startOffset + 1, end)
}

function offsetToPosition(
  text: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length))
  const before = text.slice(0, safeOffset)
  const lines = before.split("\n")
  return {
    line: lines.length - 1,
    column: lines[lines.length - 1]?.length ?? 0,
  }
}

function playgroundTsconfig(root: string): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        strict: false,
        skipLibCheck: true,
        noEmit: true,
        paths: {
          "@tskm/core": [relative(root, runtimeEntry)],
        },
      },
      include: ["src"],
    },
    null,
    2,
  )}\n`
}

function playgroundSource(schemaSource: string): string {
  return `import {
  any,
  array,
  bigint,
  boolean,
  brand,
  check,
  date,
  discriminatedUnion,
  email,
  exactObject,
  fallback,
  integer,
  lazy,
  length,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  multipleOf,
  never_,
  nonEmpty,
  null_,
  nullable,
  nullish,
  number,
  object,
  optional,
  picklist,
  pipe,
  readonly,
  record,
  recursive,
  regex,
  string,
  templateLiteral,
  transform,
  tuple,
  undefined_,
  union,
  unknown,
  url,
} from "@tskm/core"
import * as tskm from "@tskm/core"

const t = tskm
export const playgroundOutputSchema = ${schemaSource}
`
}

async function readJsonBody(
  req: IncomingMessage,
): Promise<{ readonly schemaSource?: unknown; readonly inputSource?: unknown }> {
  let body = ""
  for await (const chunk of req) {
    body += chunk
  }
  return body ? JSON.parse(body) : {}
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.statusCode = statusCode
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.setHeader("content-length", Buffer.byteLength(body))
  res.end(body)
}
