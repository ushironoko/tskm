import type { Issue } from "../types/issue.ts"

/** True if the issue fails a parse. An absent `severity` defaults to `"error"`. */
export function isErrorIssue(issue: Issue): boolean {
  return (issue.severity ?? "error") === "error"
}

/** True if the issue is a non-fatal `"warning"`. */
export function isWarningIssue(issue: Issue): boolean {
  return issue.severity === "warning"
}

/** True if any issue in the list is error-severity (i.e. the parse failed). */
export function hasErrorIssue(issues: readonly Issue[] | undefined): boolean {
  return issues?.some(isErrorIssue) ?? false
}
