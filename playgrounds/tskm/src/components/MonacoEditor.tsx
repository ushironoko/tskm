import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js"
import { useEffect, useId, useRef } from "react"
import type { InputTypecheckDiagnostic } from "../lib/typecheck.ts"

interface MonacoEditorProps {
  readonly label: string
  readonly value: string
  readonly language: "typescript" | "json"
  readonly diagnostics?: readonly InputTypecheckDiagnostic[]
  readonly onChange: (value: string) => void
  readonly minLines?: number
}

const markerOwner = "tskm-playground"

export function MonacoEditor({
  label,
  value,
  language,
  diagnostics = [],
  onChange,
  minLines = 16,
}: MonacoEditorProps) {
  const id = useId().replaceAll(":", "-")
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const initialValueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const lastValueRef = useRef(value)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const extension = language === "typescript" ? "ts" : "json"
    const uri = monaco.Uri.parse(`file:///tskm-playground/${id}.${extension}`)
    const model = monaco.editor.createModel(initialValueRef.current, language, uri)
    const editor = monaco.editor.create(container, {
      model,
      ariaLabel: label,
      automaticLayout: true,
      bracketPairColorization: { enabled: true },
      folding: false,
      fontFamily:
        'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Yu Gothic", "YuGothic", monospace',
      fontLigatures: false,
      fontSize: 13,
      lineDecorationsWidth: 10,
      lineHeight: 20,
      lineNumbers: "off",
      minimap: { enabled: false },
      overviewRulerBorder: false,
      padding: { top: 14, bottom: 14 },
      renderLineHighlight: "none",
      scrollbar: {
        alwaysConsumeMouseWheel: false,
        horizontalScrollbarSize: 10,
        verticalScrollbarSize: 10,
      },
      scrollBeyondLastLine: false,
      tabSize: 2,
      theme: "tskm-light",
      wordWrap: "off",
    })
    const subscription = editor.onDidChangeModelContent(() => {
      const nextValue = model.getValue()
      lastValueRef.current = nextValue
      onChangeRef.current(nextValue)
    })

    modelRef.current = model
    editorRef.current = editor

    return () => {
      subscription.dispose()
      editor.dispose()
      model.dispose()
      editorRef.current = null
      modelRef.current = null
    }
  }, [id, label, language])

  useEffect(() => {
    const model = modelRef.current
    if (!model || value === lastValueRef.current) return
    lastValueRef.current = value
    model.setValue(value)
  }, [value])

  useEffect(() => {
    const model = modelRef.current
    if (!model) return
    monaco.editor.setModelMarkers(model, markerOwner, diagnostics.map(toMarker))
  }, [diagnostics])

  return (
    <div
      ref={containerRef}
      className="monaco-code-editor"
      style={{ minHeight: `${minLines * 1.55}rem` }}
    />
  )
}

export function defineTskmMonacoTheme() {
  monaco.editor.defineTheme("tskm-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "identifier", foreground: "202428" },
      { token: "string", foreground: "1d6b4f" },
      { token: "number", foreground: "7356a6" },
      { token: "keyword", foreground: "7b3f64" },
      { token: "delimiter", foreground: "68706a" },
    ],
    colors: {
      "editor.background": "#fffefb",
      "editor.foreground": "#202428",
      "editor.lineHighlightBackground": "#00000000",
      "editorGutter.background": "#fffefb",
      "editorIndentGuide.background1": "#d6d9d1",
      "editorOverviewRuler.border": "#00000000",
      "editorWarning.foreground": "#c7891e",
      "editorError.foreground": "#c63c2f",
      focusBorder: "#2d6f6d",
    },
  })
}

function toMarker(diagnostic: InputTypecheckDiagnostic): monaco.editor.IMarkerData {
  const endLineNumber = diagnostic.endLine + 1
  const endColumn =
    diagnostic.endLine === diagnostic.line
      ? Math.max(diagnostic.endColumn + 1, diagnostic.column + 2)
      : diagnostic.endColumn + 1
  return {
    code: String(diagnostic.code),
    message: diagnostic.message,
    severity:
      diagnostic.category === "warning"
        ? monaco.MarkerSeverity.Warning
        : monaco.MarkerSeverity.Error,
    startLineNumber: diagnostic.line + 1,
    startColumn: diagnostic.column + 1,
    endLineNumber,
    endColumn,
  }
}
