import {
  Fragment,
  forwardRef,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ThemedToken } from "shiki/core"
import { cx } from "../lib/class-name.ts"
import type { PlaygroundHighlighter, PlaygroundLanguage } from "../lib/shiki.ts"
import { tskmIdentifierKinds } from "../lib/tskm-bindings.ts"

interface CodeEditorProps {
  readonly label: string
  readonly value: string
  readonly language: PlaygroundLanguage
  readonly highlighter: PlaygroundHighlighter | null
  readonly diagnostics?: readonly EditorDiagnostic[]
  readonly onChange: (value: string) => void
  readonly minLines?: number
}

interface HighlightedCodeProps {
  readonly value: string
  readonly language: PlaygroundLanguage
  readonly highlighter: PlaygroundHighlighter | null
  readonly diagnostics?: readonly EditorDiagnostic[]
  readonly selection?: EditorSelection | null
  readonly caretOffset?: number | null
  readonly className?: string
}

export interface EditorDiagnostic {
  readonly startOffset: number
  readonly endOffset: number
  readonly message: string
}

interface HighlightedLine {
  readonly key: string
  readonly offset: number
  readonly length: number
  readonly tokens: readonly ThemedToken[]
}

interface EditorSelection {
  readonly start: number
  readonly end: number
}

const identifierPattern = /[A-Za-z_$][\w$]*/g

export function CodeEditor({
  label,
  value,
  language,
  highlighter,
  diagnostics = [],
  onChange,
  minLines = 16,
}: CodeEditorProps) {
  const highlightRef = useRef<HTMLPreElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)
  const [selection, setSelection] = useState<EditorSelection>({ start: 0, end: 0 })
  const visibleSelection = focused ? normalizedSelection(selection) : null
  const caretOffset = focused && selection.start === selection.end ? selection.start : null

  function syncScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (!highlightRef.current) return
    highlightRef.current.scrollTop = event.currentTarget.scrollTop
    highlightRef.current.scrollLeft = event.currentTarget.scrollLeft
  }

  function syncSelection(textarea: HTMLTextAreaElement) {
    setSelection({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    })
  }

  function setTextareaSelection(textarea: HTMLTextAreaElement, anchor: number, offset: number) {
    const start = Math.min(anchor, offset)
    const end = Math.max(anchor, offset)
    const direction = offset < anchor ? "backward" : "forward"
    textarea.setSelectionRange(start, end, direction)
    syncSelection(textarea)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return

    const textarea = textareaRef.current
    const highlightedCode = highlightRef.current
    if (!textarea || !highlightedCode) return
    if (isScrollbarPointerEvent(event, textarea)) return

    const activeTextarea = textarea
    const activeHighlightedCode = highlightedCode

    event.preventDefault()

    const offset = offsetFromClientPoint(activeHighlightedCode, event.clientX, event.clientY)
    const anchor = event.shiftKey ? activeTextarea.selectionStart : offset
    activeTextarea.focus({ preventScroll: true })
    setTextareaSelection(activeTextarea, anchor, offset)

    function handlePointerMove(moveEvent: PointerEvent) {
      moveEvent.preventDefault()
      const nextOffset = offsetFromClientPoint(
        activeHighlightedCode,
        moveEvent.clientX,
        moveEvent.clientY,
      )
      setTextareaSelection(activeTextarea, anchor, nextOffset)
    }

    function handlePointerUp() {
      document.removeEventListener("pointermove", handlePointerMove)
      document.removeEventListener("pointerup", handlePointerUp)
    }

    document.addEventListener("pointermove", handlePointerMove)
    document.addEventListener("pointerup", handlePointerUp)
  }

  return (
    <div
      className={cx("code-editor", focused && "code-editor--focused")}
      onPointerDownCapture={handlePointerDown}
    >
      <HighlightedCode
        ref={highlightRef}
        value={value}
        language={language}
        highlighter={highlighter}
        diagnostics={diagnostics}
        selection={visibleSelection}
        caretOffset={caretOffset}
        className="code-editor__highlight"
      />
      <textarea
        ref={textareaRef}
        aria-label={label}
        className="code-editor__input"
        value={value}
        spellCheck={false}
        onChange={(event) => {
          onChange(event.currentTarget.value)
          syncSelection(event.currentTarget)
        }}
        onScroll={syncScroll}
        onSelect={(event) => syncSelection(event.currentTarget)}
        onKeyUp={(event) => syncSelection(event.currentTarget)}
        onMouseUp={(event) => syncSelection(event.currentTarget)}
        onFocus={(event) => {
          setFocused(true)
          syncSelection(event.currentTarget)
        }}
        onBlur={() => setFocused(false)}
        style={{ minHeight: `${minLines * 1.55}rem` }}
      />
    </div>
  )
}

export const HighlightedCode = forwardRef<HTMLPreElement, HighlightedCodeProps>(
  function HighlightedCode(
    {
      value,
      language,
      highlighter,
      diagnostics = [],
      selection = null,
      caretOffset = null,
      className,
    },
    ref,
  ) {
    const lines = useMemo(() => {
      const tokenLines = highlighter
        ? highlighter.codeToTokensBase(value, {
            lang: language,
            theme: "github-light",
          })
        : plaintextLines(value)
      return withLineKeys(tokenLines)
    }, [highlighter, language, value])

    return (
      <pre ref={ref} className={cx("highlighted-code", className)} aria-hidden="true">
        <code>
          {lines.map((line) => {
            const caretAtLineEnd = caretOffset === line.offset + line.length
            const lineDiagnostics = diagnosticsForLine(line, diagnostics)
            return (
              <span
                className="highlighted-code__line"
                data-line-length={line.length}
                data-line-offset={line.offset}
                key={line.key}
              >
                {line.tokens.length > 0 ? (
                  <>
                    {line.tokens.map((token) => (
                      <Token
                        source={value}
                        language={language}
                        token={token}
                        diagnostics={diagnostics}
                        selection={selection}
                        caretOffset={caretOffset}
                        key={token.offset}
                      />
                    ))}
                    {caretAtLineEnd && <EditorCaret />}
                    <LineDiagnostics diagnostics={lineDiagnostics} />
                  </>
                ) : (
                  <>
                    {caretOffset === line.offset && <EditorCaret />}
                    <LineDiagnostics diagnostics={lineDiagnostics} />
                    {"\n"}
                  </>
                )}
              </span>
            )
          })}
        </code>
      </pre>
    )
  },
)

function Token({
  source,
  language,
  token,
  diagnostics,
  selection,
  caretOffset,
}: {
  readonly source: string
  readonly language: PlaygroundLanguage
  readonly token: ThemedToken
  readonly diagnostics: readonly EditorDiagnostic[]
  readonly selection: EditorSelection | null
  readonly caretOffset: number | null
}) {
  const tokenEnd = token.offset + token.content.length
  const tokenCaretOffset =
    caretOffset !== null && token.offset <= caretOffset && caretOffset < tokenEnd
      ? caretOffset
      : null
  const segments = splitToken(
    token.content,
    token.offset,
    source,
    language,
    diagnostics,
    selection,
    tokenCaretOffset,
  )
  return (
    <span
      className="highlighted-code__token"
      style={{
        color: token.color,
        fontStyle: token.fontStyle === 1 ? "italic" : undefined,
      }}
    >
      {segments.map((segment) => {
        const segmentOffset = token.offset + segment.start
        const segmentKey = `${segmentOffset}-${segment.value}`
        const caretAtSegmentStart = tokenCaretOffset === segmentOffset
        const segmentClassName = cx(
          segment.selected && "editor-selection",
          segment.kind !== "plain" && "tskm-token",
          segment.kind !== "plain" && `tskm-token--${segment.kind}`,
          segment.diagnostics.length > 0 && "diagnostic-underline",
        )
        const segmentTitle =
          segment.diagnostics.length > 0
            ? segment.diagnostics.map((diagnostic) => diagnostic.message).join("\n")
            : undefined
        const segmentNode =
          segment.kind === "plain" && segment.diagnostics.length === 0 ? (
            <span className={segmentClassName || undefined}>{segment.value}</span>
          ) : (
            <span className={segmentClassName} title={segmentTitle}>
              {segment.value}
            </span>
          )
        return (
          <Fragment key={segmentKey}>
            {caretAtSegmentStart && <EditorCaret />}
            {segmentNode}
          </Fragment>
        )
      })}
    </span>
  )
}

function EditorCaret() {
  return <span className="editor-caret" aria-hidden="true" />
}

function LineDiagnostics({ diagnostics }: { readonly diagnostics: readonly EditorDiagnostic[] }) {
  if (diagnostics.length === 0) return null

  return (
    <span className="diagnostic-inline-anchor" aria-hidden="true">
      <span className="diagnostic-inline-message">
        {diagnostics.map((diagnostic) => (
          <span className="diagnostic-inline-message__item" key={diagnosticKey(diagnostic)}>
            {diagnostic.message}
          </span>
        ))}
      </span>
    </span>
  )
}

function diagnosticsForLine(
  line: HighlightedLine,
  diagnostics: readonly EditorDiagnostic[],
): readonly EditorDiagnostic[] {
  const lineEnd = line.offset + line.length
  return diagnostics.filter(
    (diagnostic) => line.offset <= diagnostic.startOffset && diagnostic.startOffset <= lineEnd,
  )
}

function diagnosticKey(diagnostic: EditorDiagnostic) {
  return `${diagnostic.startOffset}:${diagnostic.endOffset}:${diagnostic.message}`
}

function normalizedSelection(selection: EditorSelection) {
  if (selection.start === selection.end) return null

  return {
    start: Math.min(selection.start, selection.end),
    end: Math.max(selection.start, selection.end),
  }
}

function isScrollbarPointerEvent(
  event: ReactPointerEvent<HTMLDivElement>,
  textarea: HTMLTextAreaElement,
) {
  if (event.target !== textarea) return false

  const rect = textarea.getBoundingClientRect()
  const scrollbarSize = 16
  return event.clientX >= rect.right - scrollbarSize || event.clientY >= rect.bottom - scrollbarSize
}

function offsetFromClientPoint(highlightedCode: HTMLPreElement, clientX: number, clientY: number) {
  const lines = [...highlightedCode.querySelectorAll<HTMLElement>(".highlighted-code__line")]
  if (lines.length === 0) return 0

  const line = lineFromClientY(lines, clientY)
  if (!line) return 0
  const lineOffset = Number(line.dataset.lineOffset ?? 0)
  const lineLength = Number(line.dataset.lineLength ?? 0)
  if (lineLength <= 0) return lineOffset

  return lineOffset + offsetInLineFromClientX(line, clientX, lineLength)
}

function lineFromClientY(lines: readonly HTMLElement[], clientY: number) {
  let closestLine = lines[0]
  if (!closestLine) return undefined

  for (const line of lines) {
    const rect = line.getBoundingClientRect()
    if (clientY < rect.top) return line
    if (clientY <= rect.bottom) return line
    closestLine = line
  }

  return closestLine
}

function offsetInLineFromClientX(line: HTMLElement, clientX: number, lineLength: number) {
  let offset = 0
  const range = document.createRange()
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)

  while (offset < lineLength) {
    const node = walker.nextNode()
    if (!node) break

    const text = node.textContent ?? ""
    for (let index = 0; index < text.length && offset < lineLength; index++) {
      range.setStart(node, index)
      range.setEnd(node, index + 1)

      const rect = range.getBoundingClientRect()
      if (clientX <= rect.left + rect.width / 2) {
        range.detach()
        return offset
      }
      offset++
    }
  }

  range.detach()
  return lineLength
}

function splitToken(
  content: string,
  tokenOffset: number,
  source: string,
  language: PlaygroundLanguage,
  diagnostics: readonly EditorDiagnostic[],
  selection: EditorSelection | null,
  caretOffset: number | null,
) {
  const segments: Array<{
    kind: "plain" | "schema" | "action" | "method"
    start: number
    value: string
    diagnostics: readonly EditorDiagnostic[]
    selected: boolean
  }> = []
  const boundaries = new Set([0, content.length])

  for (const match of content.matchAll(identifierPattern)) {
    const index = match.index ?? 0
    boundaries.add(index)
    boundaries.add(index + match[0].length)
  }

  for (const diagnostic of diagnostics) {
    const start = Math.max(0, diagnostic.startOffset - tokenOffset)
    const end = Math.min(content.length, diagnostic.endOffset - tokenOffset)
    if (start < end) {
      boundaries.add(start)
      boundaries.add(end)
    }
  }

  if (caretOffset !== null) {
    boundaries.add(caretOffset - tokenOffset)
  }

  if (selection) {
    const start = Math.max(0, selection.start - tokenOffset)
    const end = Math.min(content.length, selection.end - tokenOffset)
    if (start < end) {
      boundaries.add(start)
      boundaries.add(end)
    }
  }

  const sorted = [...boundaries].sort((a, b) => a - b)
  for (let index = 0; index < sorted.length - 1; index++) {
    const start = sorted[index] ?? 0
    const end = sorted[index + 1] ?? start
    if (start === end) continue
    const value = content.slice(start, end)
    const sourceOffset = tokenOffset + start
    segments.push({
      kind: classifyTskmIdentifier(value, sourceOffset, source, language),
      start,
      value,
      diagnostics: diagnostics.filter((diagnostic) =>
        rangesIntersect(
          tokenOffset + start,
          tokenOffset + end,
          diagnostic.startOffset,
          diagnostic.endOffset,
        ),
      ),
      selected: selection
        ? rangesIntersect(tokenOffset + start, tokenOffset + end, selection.start, selection.end)
        : false,
    })
  }

  return segments
}

function classifyTskmIdentifier(
  value: string,
  sourceOffset: number,
  source: string,
  language: PlaygroundLanguage,
) {
  if (language !== "typescript") return "plain"

  const kind = tskmIdentifierKinds[value]
  if (!kind) return "plain"
  if (!isCodeIdentifierPosition(source, sourceOffset)) return "plain"

  const nextTokenOffset = skipInlineWhitespace(source, sourceOffset + value.length)
  return source[nextTokenOffset] === "(" ? kind : "plain"
}

function isCodeIdentifierPosition(source: string, offset: number) {
  let state: "code" | "single" | "double" | "template" | "lineComment" | "blockComment" = "code"
  let escaped = false

  for (let index = 0; index < offset; index++) {
    const char = source[index]
    const next = source[index + 1]

    if (state === "lineComment") {
      if (char === "\n") state = "code"
      continue
    }

    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        state = "code"
        index++
      }
      continue
    }

    if (state === "single" || state === "double" || state === "template") {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code"
      }
      continue
    }

    if (char === "/" && next === "/") {
      state = "lineComment"
      index++
      continue
    }
    if (char === "/" && next === "*") {
      state = "blockComment"
      index++
      continue
    }
    if (char === "'") state = "single"
    if (char === '"') state = "double"
    if (char === "`") state = "template"
  }

  return state === "code"
}

function skipInlineWhitespace(source: string, offset: number) {
  let index = offset
  while (source[index] === " " || source[index] === "\t") {
    index++
  }
  return index
}

function rangesIntersect(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA
}

function withLineKeys(lines: readonly ThemedToken[][]): readonly HighlightedLine[] {
  let offset = 0
  return lines.map((tokens) => {
    const key = `line-${offset}`
    const lineLength = tokens.reduce((total, token) => total + token.content.length, 0)
    offset += lineLength + 1
    return { key, offset: offset - lineLength - 1, length: lineLength, tokens }
  })
}

function plaintextLines(value: string): ThemedToken[][] {
  const lines = value.split("\n")
  let offset = 0
  return lines.map((line) => {
    const token = {
      content: line,
      offset,
      color: "#24292f",
    }
    offset += line.length + 1
    return [token]
  })
}
