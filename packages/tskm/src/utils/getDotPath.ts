import type { StandardSchemaV1 } from "../types/standard.ts"

/**
 * Builds a dot-path string from an issue, or `null` if any segment is a symbol
 * (which cannot be meaningfully joined). Accepts both bare `PropertyKey` and
 * `{ key }`-shaped path segments per the Standard Schema spec.
 */
export function getDotPath(issue: StandardSchemaV1.Issue): string | null {
  if (!issue.path) return null
  let dotPath = ""
  for (const item of issue.path) {
    const key = typeof item === "object" ? item.key : item
    if (typeof key === "string" || typeof key === "number") {
      dotPath += dotPath ? `.${key}` : `${key}`
    } else {
      return null
    }
  }
  return dotPath
}
