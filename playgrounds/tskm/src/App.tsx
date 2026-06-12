import { useEffect, useMemo, useState } from "react"
import { Button } from "./components/Button.tsx"
import { CodeEditor } from "./components/CodeEditor.tsx"
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
          <Pane
            title="Schema"
            variant="source"
            meta={
              <div className="legend">
                <span className="legend__item legend__item--schema">schema</span>
                <span className="legend__item legend__item--action">action</span>
                <span className="legend__item legend__item--method">method</span>
              </div>
            }
          >
            <CodeEditor
              label="tskm schema expression"
              value={schemaSource}
              language="typescript"
              highlighter={highlighter}
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
            <CodeEditor
              label="JSON input"
              value={inputSource}
              language="json"
              highlighter={highlighter}
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
