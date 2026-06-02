import type { Config } from "../types/config.ts"
import type { OutputDataset, UnknownDataset } from "../types/dataset.ts"
import type { Issue, IssuePathItem } from "../types/issue.ts"
import { _received } from "./_received.ts"

export interface IssueInfo {
  readonly kind: "schema" | "validation" | "transformation"
  readonly type: string
  readonly expected: string | null
  readonly message?: string | undefined
  readonly path?: readonly IssuePathItem[] | undefined
}

type MutableDataset = {
  typed?: boolean
  value: unknown
  issues?: Issue[]
}

/**
 * Appends an issue to the dataset (mutating it in place, valibot-style). A
 * `"schema"`-kind issue also marks the dataset untyped (wrong shape).
 */
export function _addIssue(
  dataset: UnknownDataset | OutputDataset<unknown>,
  info: IssueInfo,
  _config: Config,
): void {
  const received = _received(dataset.value)
  const message =
    info.message ??
    (info.expected !== null
      ? `Invalid ${info.kind === "schema" ? "type" : info.type}: Expected ${info.expected} but received ${received}`
      : `Invalid ${info.type}: Received ${received}`)

  const issue: Issue = {
    kind: info.kind,
    type: info.type,
    expected: info.expected,
    received,
    message,
    input: dataset.value,
    path: info.path,
  }

  const mutable = dataset as MutableDataset
  if (mutable.issues) {
    mutable.issues.push(issue)
  } else {
    mutable.issues = [issue]
  }
  if (info.kind === "schema") {
    mutable.typed = false
  }
}
