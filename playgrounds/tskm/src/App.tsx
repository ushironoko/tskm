import { useEffect, useMemo, useState } from "react"
import { Button } from "./components/Button.tsx"
import { MonacoEditor } from "./components/MonacoEditor.tsx"
import { Pane } from "./components/Pane.tsx"
import { ResultView } from "./components/ResultView.tsx"
import { SegmentedControl } from "./components/SegmentedControl.tsx"
import { examples } from "./examples.ts"
import {
  fetchGeneratedType,
  type GeneratedTypeState,
  renderFallbackContent,
} from "./lib/generated-type.ts"
import { type PlaygroundConfig, runSchema } from "./lib/run-schema.ts"
import { createPlaygroundHighlighter, type PlaygroundHighlighter } from "./lib/shiki.ts"
import { fetchInputTypecheck, type InputTypecheckState } from "./lib/typecheck.ts"

const modeOptions = [
  { value: "report", label: "report" },
  { value: "reject", label: "reject" },
] as const

const githubUrl = "https://github.com/ushironoko/tskm"

export function App() {
  const [highlighter, setHighlighter] = useState<PlaygroundHighlighter | null>(null)
  const [activeExampleId, setActiveExampleId] = useState(examples[0]?.id ?? "")
  const activeExample = examples.find((example) => example.id === activeExampleId) ?? examples[0]
  const [schemaSource, setSchemaSource] = useState(activeExample?.schema ?? "")
  const [inputSource, setInputSource] = useState(activeExample?.input ?? "")
  const [config, setConfig] = useState<PlaygroundConfig>({
    mode: "report",
    abortPipeEarly: true,
  })
  const [generatedType, setGeneratedType] = useState<GeneratedTypeState>(() =>
    renderFallbackContent(activeExample?.schema ?? ""),
  )
  const [inputTypecheck, setInputTypecheck] = useState<InputTypecheckState>({
    status: "idle",
    diagnostics: [],
  })

  useEffect(() => {
    let disposed = false
    createPlaygroundHighlighter({ langs: ["typescript", "json"], themes: ["github-light"] }).then(
      (instance) => {
        if (disposed) {
          instance.dispose()
        } else {
          setHighlighter(instance)
        }
      },
    )
    return () => {
      disposed = true
    }
  }, [])

  const result = useMemo(
    () => runSchema(schemaSource, inputSource, config),
    [schemaSource, inputSource, config],
  )

  useEffect(() => {
    const fallback = renderFallbackContent(schemaSource)
    setGeneratedType({ ...fallback, status: "loading", label: fallback.label })

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      fetchGeneratedType(schemaSource, controller.signal)
        .then(setGeneratedType)
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setGeneratedType({
            ...fallback,
            message: error instanceof Error ? error.message : String(error),
          })
        })
    }, 450)

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [schemaSource])

  useEffect(() => {
    setInputTypecheck((current) => ({ ...current, status: "loading" }))

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      fetchInputTypecheck(schemaSource, inputSource, controller.signal)
        .then(setInputTypecheck)
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setInputTypecheck({
            status: "error",
            diagnostics: [],
            message: error instanceof Error ? error.message : String(error),
          })
        })
    }, 450)

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [schemaSource, inputSource])

  function loadExample(exampleId: string) {
    const example = examples.find((item) => item.id === exampleId)
    if (!example) return
    setActiveExampleId(example.id)
    setSchemaSource(example.schema)
    setInputSource(example.input)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <p className="brand-lockup__name">tskm playground</p>
        </div>
        <div className="topbar__controls">
          <a
            className="github-link"
            href={githubUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open tskm on GitHub"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.86 8.35 6.83 9.7.5.1.68-.22.68-.5 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.22-3.37-1.22-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.92c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .28.18.6.69.5A10.05 10.05 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
            </svg>
            <span className="visually-hidden">Open tskm on GitHub</span>
          </a>
          <SegmentedControl
            ariaLabel="parse mode"
            value={config.mode}
            options={modeOptions}
            onChange={(mode) => setConfig((current) => ({ ...current, mode }))}
          />
          <label className="checkbox-control">
            <input
              type="checkbox"
              checked={config.abortPipeEarly}
              onChange={(event) => {
                const { checked } = event.currentTarget
                setConfig((current) => ({
                  ...current,
                  abortPipeEarly: checked,
                }))
              }}
            />
            abort pipe early
          </label>
        </div>
      </header>

      <div className="workbench">
        <Pane title="Examples" variant="sidebar">
          <nav className="example-list" aria-label="Playground examples">
            {examples.map((example) => (
              <Button
                type="button"
                key={example.id}
                variant={example.id === activeExampleId ? "primary" : "quiet"}
                onClick={() => loadExample(example.id)}
              >
                <span>{example.label}</span>
                <small>{example.description}</small>
              </Button>
            ))}
          </nav>
        </Pane>

        <div className="editor-grid">
          <Pane title="Schema" variant="source">
            <MonacoEditor
              label="tskm schema expression"
              value={schemaSource}
              language="typescript"
              onChange={setSchemaSource}
              minLines={19}
            />
          </Pane>

          <Pane
            title="Input"
            variant="input"
            meta={
              <div className="input-meta">
                <span className="pane-note">JSON</span>
              </div>
            }
          >
            <MonacoEditor
              label="JSON input"
              value={inputSource}
              language="json"
              diagnostics={inputTypecheck.diagnostics}
              onChange={setInputSource}
              minLines={19}
            />
          </Pane>
        </div>

        <Pane title="Result" variant="result">
          <ResultView result={result} generatedType={generatedType} highlighter={highlighter} />
        </Pane>
      </div>
    </main>
  )
}
