import type * as monacoTypes from "monaco-editor/esm/vs/editor/editor.main.js"
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

export interface MonacoTypecheckDiagnostic {
  readonly start?: number
  readonly length?: number
  readonly messageText: string | DiagnosticMessageChain
  readonly message?: string
  readonly category: number
  readonly code: number
}

interface DiagnosticMessageChain {
  readonly messageText: string
  readonly next?: readonly DiagnosticMessageChain[]
}

type MonacoModule = typeof import("monaco-editor/esm/vs/editor/editor.main.js")
type TypecheckResponse = TypecheckSuccess | TypecheckFailure

const endpoint = "/__tskm_playground/typecheck"
const hasTypecheckEndpoint = import.meta.env.DEV || import.meta.env.VITE_TSKM_PLAYGROUND_API === "1"
const inputUriPath = "/tskm-playground/playground.input.ts"
const generatedUriPath = "/tskm-playground/playground.schema.gen.ts"
const inputPrefix = `import type { PlaygroundOutput } from "./playground.schema.gen"\n\nconst playgroundInput: PlaygroundOutput = `
const inputSuffix = "\n"

let hasConfiguredMonacoTypeScript = false

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

  const monaco = await import("monaco-editor/esm/vs/editor/editor.main.js")
  configureMonacoTypeScript(monaco)

  const inputUri = monaco.Uri.parse(`file://${inputUriPath}`)
  const generatedUri = monaco.Uri.parse(`file://${generatedUriPath}`)
  upsertModel(monaco, inputUri, createTypecheckInputText(inputSource))
  upsertModel(monaco, generatedUri, generatedType.content)

  const ready = await waitForTypeScriptReady(monaco, inputUri)
  if (!ready) {
    return {
      status: "error",
      diagnostics: [],
      message: "TypeScript worker is not ready.",
    }
  }

  const worker = await monaco.typescript.getTypeScriptWorker()
  const client = await worker(inputUri)
  const [syntacticDiagnostics, semanticDiagnostics] = await Promise.all([
    client.getSyntacticDiagnostics(inputUri.toString()),
    client.getSemanticDiagnostics(inputUri.toString()),
  ])
  const diagnostics = [
    ...syntacticDiagnostics,
    ...semanticDiagnostics,
  ] as MonacoTypecheckDiagnostic[]

  return {
    status: "ready",
    diagnostics: diagnostics.map((diagnostic) => toEditorDiagnostic(diagnostic, inputSource)),
  }
}

export function createTypecheckInputText(inputSource: string): string {
  return `${inputPrefix}${inputSource}${inputSuffix}`
}

export function toEditorDiagnostic(
  diagnostic: MonacoTypecheckDiagnostic,
  inputSource: string,
): InputTypecheckDiagnostic {
  const inputStart = inputPrefix.length
  const inputEnd = inputStart + inputSource.length
  const fallbackStart = firstNonWhitespaceOffset(inputSource)
  const message = flattenDiagnosticMessage(diagnostic)
  const rawStart = diagnostic.start ?? inputStart + fallbackStart
  const mappedStartOffset =
    rawStart >= inputStart && rawStart <= inputEnd ? rawStart - inputStart : fallbackStart
  const startOffset = valueStartForTypeMismatch(inputSource, mappedStartOffset, message)
  const endOffset = Math.min(expandDiagnosticEnd(inputSource, startOffset), inputSource.length)
  const start = offsetToPosition(inputSource, startOffset)
  const end = offsetToPosition(inputSource, endOffset)

  return {
    code: diagnostic.code,
    category: diagnosticCategory(diagnostic.category),
    message,
    startOffset,
    endOffset,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
  }
}

function configureMonacoTypeScript(monaco: MonacoModule): void {
  if (hasConfiguredMonacoTypeScript) return

  monaco.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    noImplicitAny: false,
    strictNullChecks: false,
    esModuleInterop: true,
  })
  monaco.typescript.typescriptDefaults.setEagerModelSync(true)
  hasConfiguredMonacoTypeScript = true
}

function upsertModel(
  monaco: MonacoModule,
  uri: monacoTypes.Uri,
  text: string,
): monacoTypes.editor.ITextModel {
  const current = monaco.editor.getModel(uri)
  if (current) {
    if (current.getValue() !== text) current.setValue(text)
    return current
  }
  return monaco.editor.createModel(text, "typescript", uri)
}

async function waitForTypeScriptReady(
  monaco: MonacoModule,
  uri: monacoTypes.Uri,
): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const worker = await monaco.typescript.getTypeScriptWorker()
      await worker(uri)
      return true
    } catch (error) {
      if (!String(error).includes("TypeScript not registered")) {
        throw error
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    }
  }
  return false
}

function diagnosticCategory(category: number): string {
  return category === 0 ? "warning" : category === 1 ? "error" : "info"
}

function flattenDiagnosticMessage(diagnostic: MonacoTypecheckDiagnostic): string {
  if (typeof diagnostic.message === "string") return diagnostic.message
  return flattenMessageText(diagnostic.messageText)
}

function flattenMessageText(messageText: string | DiagnosticMessageChain): string {
  if (typeof messageText === "string") return messageText
  const next = messageText.next?.map(flattenMessageText) ?? []
  return [messageText.messageText, ...next].join("\n")
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
