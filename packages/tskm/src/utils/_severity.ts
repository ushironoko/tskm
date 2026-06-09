import type { Issue } from "../types/issue.ts"

/** True only for an exact `"warning"` severity (the single non-fatal value). */
export function isWarningIssue(issue: Issue): boolean {
  return issue.severity === "warning"
}

/**
 * True if the issue fails a parse. Fail-closed: ONLY an exact `"warning"` is non-fatal, so
 * an absent, `"error"`, or unknown/typo severity (a JS or `as any` caller could pass one
 * through the public `ctx.issue` API) is treated as an error and stays visible, never
 * silently swallowed into a successful parse.
 */
export function isErrorIssue(issue: Issue): boolean {
  return !isWarningIssue(issue)
}

/** True if any issue in the list is error-severity (i.e. the parse failed). */
export function hasErrorIssue(issues: readonly Issue[] | undefined): boolean {
  return issues?.some(isErrorIssue) ?? false
}
