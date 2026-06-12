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

export async function fetchInputTypecheck(
  schemaSource: string,
  inputSource: string,
  signal: AbortSignal,
): Promise<InputTypecheckState> {
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
