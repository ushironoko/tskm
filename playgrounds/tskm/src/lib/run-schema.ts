import { type Config, flatten, getDotPath, type Issue, safeParse } from "@tskm/core"
import { tskmBindings } from "./tskm-bindings.ts"

export interface PlaygroundConfig {
  readonly mode: "report" | "reject"
  readonly abortPipeEarly: boolean
}

export interface PlaygroundIssue {
  readonly path: string
  readonly type: string
  readonly kind: string
  readonly severity: "error" | "warning"
  readonly message: string
}

export interface PlaygroundSuccess {
  readonly status: "success"
  readonly output: unknown
  readonly warnings: readonly PlaygroundIssue[]
  readonly flatErrors: undefined
}

export interface PlaygroundFailure {
  readonly status: "failure"
  readonly output: unknown
  readonly issues: readonly PlaygroundIssue[]
  readonly warnings: readonly PlaygroundIssue[]
  readonly flatErrors: ReturnType<typeof flatten>
}

export interface PlaygroundRuntimeError {
  readonly status: "runtime-error"
  readonly message: string
}

export type PlaygroundRunResult = PlaygroundSuccess | PlaygroundFailure | PlaygroundRuntimeError

export function runSchema(
  schemaSource: string,
  inputSource: string,
  playgroundConfig: PlaygroundConfig,
): PlaygroundRunResult {
  try {
    const schema = compileSchema(schemaSource)
    const input = parseInput(inputSource)
    const config: Config = {
      mode: playgroundConfig.mode,
      abortPipeEarly: playgroundConfig.abortPipeEarly,
    }
    const result = safeParse(schema, input, config)
    const warnings = result.warnings.map(toPlaygroundIssue)

    if (result.success) {
      return {
        status: "success",
        output: result.output,
        warnings,
        flatErrors: undefined,
      }
    }

    return {
      status: "failure",
      output: result.output,
      issues: result.issues.map(toPlaygroundIssue),
      warnings,
      flatErrors: flatten(result.issues),
    }
  } catch (error) {
    return {
      status: "runtime-error",
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function compileSchema(schemaSource: string) {
  const keys = Object.keys(tskmBindings)
  const values = Object.values(tskmBindings)
  return new Function(...keys, `"use strict";\nreturn (${schemaSource});`)(...values)
}

function parseInput(inputSource: string) {
  return JSON.parse(inputSource)
}

function toPlaygroundIssue(issue: Issue): PlaygroundIssue {
  return {
    path: getDotPath(issue) ?? "root",
    type: issue.type,
    kind: issue.kind,
    severity: issue.severity ?? "error",
    message: issue.message,
  }
}
