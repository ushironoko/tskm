import { formatJson } from "../lib/format.ts"
import type { GeneratedTypeState } from "../lib/generated-type.ts"
import type { PlaygroundRunResult } from "../lib/run-schema.ts"
import type { PlaygroundHighlighter } from "../lib/shiki.ts"
import { HighlightedCode } from "./CodeEditor.tsx"
import { StatusBadge } from "./StatusBadge.tsx"

interface ResultViewProps {
  readonly result: PlaygroundRunResult
  readonly generatedType: GeneratedTypeState
  readonly highlighter: PlaygroundHighlighter | null
}

export function ResultView({ result, generatedType, highlighter }: ResultViewProps) {
  if (result.status === "runtime-error") {
    return (
      <div className="result-stack">
        <StatusBadge variant="error">Runtime error</StatusBadge>
        <p className="runtime-error">{result.message}</p>
        <GeneratedTypeBlock generatedType={generatedType} highlighter={highlighter} />
      </div>
    )
  }

  return (
    <div className="result-stack">
      {result.warnings.length > 0 ? (
        <div className="result-summary">
          <StatusBadge variant="warning">{result.warnings.length} warning(s)</StatusBadge>
        </div>
      ) : null}

      <GeneratedTypeBlock generatedType={generatedType} highlighter={highlighter} />

      {result.status === "failure" ? (
        <div className="output-block">
          <p className="output-block__label">Validation errors</p>
          <table className="issue-table">
            <thead>
              <tr>
                <th scope="col">Path</th>
                <th scope="col">Kind</th>
                <th scope="col">Type</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {result.issues.map((issue) => (
                <tr key={issueKey(issue)}>
                  <td>{issue.path}</td>
                  <td>{issue.kind}</td>
                  <td>{issue.type}</td>
                  <td>{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="issue-list">
          {result.warnings.map((warning) => (
            <p key={issueKey(warning)}>
              <span>{warning.path}</span>
              {warning.message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="output-block">
        <p className="output-block__label">Output</p>
        <HighlightedCode
          value={formatJson(result.output)}
          language="json"
          highlighter={highlighter}
        />
      </div>

      {result.status === "failure" ? (
        <div className="output-block">
          <p className="output-block__label">Flattened errors</p>
          <HighlightedCode
            value={formatJson(result.flatErrors)}
            language="json"
            highlighter={highlighter}
          />
        </div>
      ) : null}
    </div>
  )
}

function GeneratedTypeBlock({
  generatedType,
  highlighter,
}: {
  readonly generatedType: GeneratedTypeState
  readonly highlighter: PlaygroundHighlighter | null
}) {
  const badgeVariant =
    generatedType.status === "ready"
      ? "success"
      : generatedType.status === "error"
        ? "error"
        : "neutral"

  return (
    <div className="output-block">
      <div className="output-block__header">
        <p className="output-block__label">Generated type</p>
        <div className="output-block__badges">
          <StatusBadge variant={badgeVariant}>
            {generatedType.status === "loading" ? "loading" : generatedType.label}
          </StatusBadge>
        </div>
      </div>
      {generatedType.message ? <p className="typegen-message">{generatedType.message}</p> : null}
      {generatedType.diagnostics.length > 0 ? (
        <div className="typegen-diagnostics">
          {generatedType.diagnostics.map((diagnostic) => (
            <p key={diagnostic}>{diagnostic}</p>
          ))}
        </div>
      ) : null}
      <HighlightedCode
        value={generatedType.content}
        language="typescript"
        highlighter={highlighter}
      />
    </div>
  )
}

function issueKey(issue: {
  readonly path: string
  readonly kind: string
  readonly type: string
  readonly message: string
}) {
  return `${issue.path}:${issue.kind}:${issue.type}:${issue.message}`
}
