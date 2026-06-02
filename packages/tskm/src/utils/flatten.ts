import type { Issue } from "../types/issue.ts"
import { getDotPath } from "./getDotPath.ts"

/**
 * Flattened view of issues, keyed by dot-path. `root` collects issues with no
 * (or non-joinable) path; `nested` maps each dot-path to its messages.
 */
export interface FlatErrors {
  readonly root: string[]
  readonly nested: Record<string, string[]>
}

/**
 * Groups issue messages by their dot-path. Issues without a joinable path land
 * in `root`; the rest are bucketed under `nested[dotPath]`.
 */
export function flatten(issues: readonly Issue[]): FlatErrors {
  const root: string[] = []
  const nested: Record<string, string[]> = {}
  for (const issue of issues) {
    const dotPath = getDotPath(issue)
    if (dotPath === null) {
      root.push(issue.message)
    } else {
      const bucket = nested[dotPath]
      if (bucket) {
        bucket.push(issue.message)
      } else {
        nested[dotPath] = [issue.message]
      }
    }
  }
  return { root, nested }
}
