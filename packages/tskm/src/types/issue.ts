/** One segment of an issue path, e.g. `{ key: "name" }` or `{ key: 0 }`. */
export interface IssuePathItem {
  readonly key: PropertyKey
}

/**
 * Rich internal issue. Converted to the lean Standard Schema issue
 * (`{ message, path? }`) at the `~standard.validate` boundary.
 */
export interface Issue {
  /** Whether the issue came from a schema, a validation, or a transformation. */
  readonly kind: "schema" | "validation" | "transformation"
  /** The specific check that failed, e.g. `"string"`, `"min_length"`. */
  readonly type: string
  /** Human-readable description of what was expected, or `null`. */
  readonly expected: string | null
  /** Human-readable description of what was received. */
  readonly received: string
  /** The error message. */
  readonly message: string
  /** The offending input value. */
  readonly input: unknown
  /** Path from the root value to the offending value. Built by parent schemas. */
  readonly path?: readonly IssuePathItem[] | undefined
}
