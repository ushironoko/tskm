import type * as ts from "typescript"
import { renderFallbackContent } from "./generated-type.ts"

export interface InputTypecheckDiagnostic {
  readonly code: number
  readonly category: string
  readonly message: string
  readonly startOffset: number
  readonly endOffset: number
  readonly line: number
  readonly column: number
  readonly endLine: number
  readonly endColumn: number
}

export interface InputTypecheckState {
  readonly status: "idle" | "loading" | "ready" | "error"
  readonly diagnostics: readonly InputTypecheckDiagnostic[]
  readonly message?: string
}

interface TypecheckSuccess {
  readonly ok: true
  readonly diagnostics: readonly InputTypecheckDiagnostic[]
  readonly compilerDiagnostics?: readonly string[]
}

interface TypecheckFailure {
  readonly ok: false
  readonly message: string
  readonly diagnostics?: readonly InputTypecheckDiagnostic[]
  readonly compilerDiagnostics?: readonly string[]
}

type TypecheckResponse = TypecheckSuccess | TypecheckFailure

const endpoint = "/__tskm_playground/typecheck"
const hasTypecheckEndpoint = import.meta.env.DEV || import.meta.env.VITE_TSKM_PLAYGROUND_API === "1"
const inputFileName = "/playground.input.ts"
const generatedFileName = "/playground.schema.gen.ts"
const libFileName = "/lib.d.ts"
const inputPrefix = `import type { PlaygroundOutput } from "./playground.schema.gen"\n\nconst playgroundInput: PlaygroundOutput = `
const inputSuffix = "\n"
const clientLibDts = `
interface Array<T> {
  length: number
  [n: number]: T
}
interface Boolean {}
interface CallableFunction extends Function {}
interface Date {}
interface Function {}
interface IArguments {}
interface NewableFunction extends Function {}
interface Number {}
interface Object {}
interface ReadonlyArray<T> {
  readonly length: number
  readonly [n: number]: T
}
interface RegExp {}
interface String {}
type Readonly<T> = {
  readonly [P in keyof T]: T[P]
}
`

export async function fetchInputTypecheck(
  schemaSource: string,
  inputSource: string,
  signal: AbortSignal,
): Promise<InputTypecheckState> {
  if (!hasTypecheckEndpoint) {
    return typecheckInputInBrowser(schemaSource, inputSource)
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaSource, inputSource }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`typecheck endpoint returned ${response.status}`)
  }

  const result = (await response.json()) as TypecheckResponse
  if (result.ok) {
    return {
      status: "ready",
      diagnostics: result.diagnostics,
    }
  }

  return {
    status: "error",
    diagnostics: result.diagnostics ?? [],
    message: result.message,
  }
}

export async function typecheckInputInBrowser(
  schemaSource: string,
  inputSource: string,
): Promise<InputTypecheckState> {
  const generatedType = renderFallbackContent(schemaSource)
  if (generatedType.status === "error") {
    return {
      status: "error",
      diagnostics: [],
      message: generatedType.message,
    }
  }

  const typescript = await import("typescript")
  const inputText = `${inputPrefix}${inputSource}${inputSuffix}`
  const program = createVirtualProgram(typescript, inputText, generatedType.content)
  const sourceFile = program.getSourceFile(inputFileName)
  if (!sourceFile) {
    return {
      status: "error",
      diagnostics: [],
      message: "Unable to prepare playground input for typechecking.",
    }
  }

  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ]

  return {
    status: "ready",
    diagnostics: diagnostics.map((diagnostic) =>
      toEditorDiagnostic(typescript, diagnostic, inputSource),
    ),
  }
}

function createVirtualProgram(
  typescript: typeof ts,
  inputText: string,
  generatedText: string,
): ts.Program {
  const files = new Map([
    [inputFileName, inputText],
    [generatedFileName, generatedText],
    [libFileName, clientLibDts],
  ])
  const options: ts.CompilerOptions = {
    target: typescript.ScriptTarget.ESNext,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.Bundler,
    strict: false,
    skipLibCheck: true,
    noEmit: true,
    noLib: true,
  }
  const host = typescript.createCompilerHost(options, true)

  host.getSourceFile = (fileName, languageVersion) => {
    const text = files.get(normalizeFileName(fileName))
    return text === undefined
      ? undefined
      : typescript.createSourceFile(fileName, text, languageVersion, true)
  }
  host.fileExists = (fileName) => files.has(normalizeFileName(fileName))
  host.readFile = (fileName) => files.get(normalizeFileName(fileName))
  host.writeFile = () => {}
  host.getDefaultLibFileName = () => libFileName
  host.getCurrentDirectory = () => "/"
  host.getCanonicalFileName = normalizeFileName
  host.useCaseSensitiveFileNames = () => true
  host.getNewLine = () => "\n"
  host.resolveModuleNames = (moduleNames) =>
    moduleNames.map((moduleName) =>
      moduleName === "./playground.schema.gen"
        ? {
            resolvedFileName: generatedFileName,
            extension: typescript.Extension.Ts,
            isExternalLibraryImport: false,
          }
        : undefined,
    )

  return typescript.createProgram([inputFileName], options, host)
}

function toEditorDiagnostic(
  typescript: typeof ts,
  diagnostic: ts.Diagnostic,
  inputSource: string,
): InputTypecheckDiagnostic {
  const inputStart = inputPrefix.length
  const inputEnd = inputStart + inputSource.length
  const fallbackStart = firstNonWhitespaceOffset(inputSource)
  const rawStart = diagnostic.start ?? inputStart + fallbackStart
  const mappedStartOffset =
    rawStart >= inputStart && rawStart <= inputEnd ? rawStart - inputStart : fallbackStart
  const startOffset = valueStartForTypeMismatch(
    inputSource,
    mappedStartOffset,
    flattenDiagnosticMessage(typescript, diagnostic),
  )
  const endOffset = Math.min(expandDiagnosticEnd(inputSource, startOffset), inputSource.length)
  const start = offsetToPosition(inputSource, startOffset)
  const end = offsetToPosition(inputSource, endOffset)

  return {
    code: diagnostic.code,
    category: diagnosticCategory(typescript, diagnostic.category),
    message: flattenDiagnosticMessage(typescript, diagnostic),
    startOffset,
    endOffset,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
  }
}

function diagnosticCategory(typescript: typeof ts, category: ts.DiagnosticCategory): string {
  return typescript.DiagnosticCategory[category]?.toLowerCase() ?? "error"
}

function flattenDiagnosticMessage(typescript: typeof ts, diagnostic: ts.Diagnostic): string {
  return typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
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

function skipWhitespace(text: string, offset: number) {
  let index = offset
  while (/\s/.test(text[index] ?? "")) {
    index += 1
  }
  return index
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

function normalizeFileName(fileName: string): string {
  return fileName.startsWith("/") ? fileName : `/${fileName}`
}
