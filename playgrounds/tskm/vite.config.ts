import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, URL } from "node:url"
import { generate, resolveTsgoExecutable } from "@tskm/compiler"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const runtimeEntry = fileURLToPath(new URL("../../packages/tskm/src/index.ts", import.meta.url))
const typegenEndpoint = "/__tskm_playground/typegen"
const typecheckEndpoint = "/__tskm_playground/typecheck"
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

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

    const typecheckOutput = await runTsgoNoEmit(root)

    return {
      ok: true,
      diagnostics: collectTypecheckDiagnostics(
        root,
        typecheckOutput,
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

interface CliDiagnostic {
  readonly fileName: string
  readonly line: number
  readonly column: number
  readonly code: number
  readonly category: string
  readonly message: string
}

function runTsgoNoEmit(root: string): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      resolveTsgoExecutable(),
      ["--noEmit", "--pretty", "false", "-p", "tsconfig.json"],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join("\n")
        if (!error || typeof error.code === "number") {
          resolveOutput(output)
          return
        }
        reject(error)
      },
    )
  })
}

function collectTypecheckDiagnostics(
  root: string,
  output: string,
  inputFile: string,
  inputText: string,
  inputStart: number,
  inputSource: string,
) {
  const inputEnd = inputStart + inputSource.length
  return parseTsgoDiagnostics(output)
    .filter((diagnostic) => sameFile(root, diagnostic.fileName, inputFile))
    .map((diagnostic) =>
      toEditorDiagnostic(diagnostic, inputText, inputSource, inputStart, inputEnd),
    )
}

function toEditorDiagnostic(
  diagnostic: CliDiagnostic,
  inputText: string,
  inputSource: string,
  inputStart: number,
  inputEnd: number,
) {
  const fallbackStart = firstNonWhitespaceOffset(inputSource)
  const rawStart = positionToOffset(inputText, diagnostic.line - 1, diagnostic.column - 1)
  const mappedStartOffset =
    rawStart >= inputStart && rawStart <= inputEnd ? rawStart - inputStart : fallbackStart
  const startOffset = valueStartForTypeMismatch(inputSource, mappedStartOffset, diagnostic.message)
  const endOffset = expandDiagnosticEnd(inputSource, startOffset)
  const start = offsetToPosition(inputSource, startOffset)
  const end = offsetToPosition(inputSource, Math.min(endOffset, inputSource.length))

  return {
    code: diagnostic.code,
    category: diagnostic.category,
    message: diagnostic.message,
    startOffset,
    endOffset: Math.min(endOffset, inputSource.length),
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
  }
}

function valueStartForTypeMismatch(text: string, startOffset: number, message: string): number {
  if (!message.startsWith("Type ") || !message.includes(" is not assignable to type ")) {
    return startOffset
  }

  const keyMatch = /"(?:\\.|[^"\\])*"/y
  keyMatch.lastIndex = startOffset
  const match = keyMatch.exec(text)
  if (!match) return startOffset

  let index = startOffset + match[0].length
  index = skipWhitespace(text, index)
  if (text[index] !== ":") return startOffset
  index = skipWhitespace(text, index + 1)
  return index < text.length ? index : startOffset
}

function parseTsgoDiagnostics(output: string): readonly CliDiagnostic[] {
  const diagnostics: CliDiagnostic[] = []
  let current: CliDiagnostic | undefined

  for (const rawLine of output.split(/\r?\n/)) {
    const line = stripAnsi(rawLine)
    const match = /^(.*)\((\d+),(\d+)\):\s+(\w+)\s+TS(\d+):\s+(.*)$/.exec(line)
    if (match) {
      if (current) diagnostics.push(current)
      current = {
        fileName: match[1] ?? "",
        line: Number(match[2]),
        column: Number(match[3]),
        category: match[4] ?? "error",
        code: Number(match[5]),
        message: match[6] ?? "",
      }
      continue
    }

    if (current && line.trim()) {
      current = {
        ...current,
        message: `${current.message}\n${line.trim()}`,
      }
    }
  }

  if (current) diagnostics.push(current)
  return diagnostics
}

function sameFile(root: string, diagnosticFileName: string, inputFile: string): boolean {
  const absoluteDiagnosticFile = isAbsolute(diagnosticFileName)
    ? diagnosticFileName
    : resolve(root, diagnosticFileName)
  return absoluteDiagnosticFile === inputFile
}

function firstNonWhitespaceOffset(text: string): number {
  const match = /\S/.exec(text)
  return match?.index ?? 0
}

function expandDiagnosticEnd(text: string, startOffset: number): number {
  const tokenEnd = endOfToken(text, startOffset)
  if (tokenEnd !== null) return tokenEnd
  return expandFallbackEnd(text, startOffset)
}

function expandFallbackEnd(text: string, startOffset: number): number {
  const lineEnd = text.indexOf("\n", startOffset)
  const end = lineEnd === -1 ? text.length : lineEnd
  return Math.max(startOffset + 1, end)
}

function endOfToken(text: string, offset: number): number | null {
  const start = Math.max(0, Math.min(offset, text.length))
  const tokenPattern =
    /"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*/g
  for (const match of text.matchAll(tokenPattern)) {
    const tokenStart = match.index
    if (tokenStart === undefined) continue
    const tokenEnd = tokenStart + match[0].length
    if (tokenStart <= start && start < tokenEnd) return tokenEnd
    if (start < tokenStart) return tokenEnd
  }
  return null
}

function skipWhitespace(text: string, offset: number): number {
  let index = offset
  while (/\s/.test(text[index] ?? "")) {
    index += 1
  }
  return index
}

function positionToOffset(text: string, line: number, column: number): number {
  const lines = text.split("\n")
  const safeLine = Math.max(0, Math.min(line, lines.length - 1))
  let offset = 0
  for (let index = 0; index < safeLine; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1
  }
  return offset + Math.max(0, Math.min(column, lines[safeLine]?.length ?? 0))
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

function stripAnsi(text: string): string {
  return text.replace(ansiEscapePattern, "")
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
