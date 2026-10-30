import type { Config } from "../types/config.ts"
import type { MutableDataset, OutputDataset, UnknownDataset } from "../types/dataset.ts"
import type { InferOutput } from "../types/infer.ts"
import type { Issue, IssueSeverity } from "../types/issue.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { _received } from "../utils/_received.ts"
import { isErrorIssue } from "../utils/_severity.ts"

/**
 * Diagnostic channel for a preprocess operation. `issue` records a failure or a
 * warning without throwing. An `"error"` (the default) skips the inner schema.
 * A `"warning"` keeps the returned value and still runs the inner schema.
 */
export interface PreprocessContext {
  issue(message: string, severity?: IssueSeverity): void
}

/**
 * A schema that maps an untrusted value before the inner schema validates it.
 * `TWrapped` is the inner schema, so `InferOutput` stays the inner output type
 * (the same shape as `OptionalSchema<TWrapped>`). The input type is always
 * `unknown`: `~run` receives `unknown` and does not check a caller-declared
 * input before the operation runs.
 *
 * `templateLiteral` placeholders and `record` keys are out of scope. A
 * placeholder rejects `type: "preprocess"` at construction. There is no
 * declared-input helper (`preprocessAs`) in v1.
 */
export interface PreprocessSchema<TWrapped extends BaseSchema<unknown, unknown>>
  extends BaseSchema<unknown, InferOutput<TWrapped>> {
  readonly type: "preprocess"
  readonly reference: typeof preprocess
  readonly wrapped: TWrapped
  readonly operation: (input: unknown, ctx: PreprocessContext) => unknown
}

/** Message for a thrown preprocess operation. Non-Errors use `String(error)`. */
export function preprocessThrownMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Invalid preprocess: ${detail}`
}

export function preprocessIssue(
  original: unknown,
  message: string,
  severity: IssueSeverity,
): Issue {
  return {
    kind: "transformation",
    type: "preprocess",
    expected: null,
    received: _received(original),
    message,
    input: original,
    severity,
  }
}

function halt(dataset: UnknownDataset, original: unknown, issues: readonly Issue[]): void {
  const out = dataset as MutableDataset
  out.value = original
  out.typed = false
  out.issues = out.issues ? [...out.issues, ...issues] : [...issues]
}

function attach(dataset: UnknownDataset, issues: readonly Issue[]): void {
  if (issues.length === 0) return
  const out = dataset as MutableDataset
  out.issues = out.issues ? [...out.issues, ...issues] : [...issues]
}

/**
 * Applies a settled preprocess operation to `dataset`. An error-severity issue
 * keeps `original`, marks the dataset untyped, and does not run `wrapped`.
 * Otherwise the produced value is validated by `wrapped`.
 */
function applyPreprocess(
  dataset: UnknownDataset,
  original: unknown,
  produced: unknown,
  collected: readonly Issue[],
  wrapped: BaseSchema<unknown, unknown>,
  config: Config,
): OutputDataset<unknown> {
  if (collected.some(isErrorIssue)) {
    halt(dataset, original, collected)
    return dataset as unknown as OutputDataset<unknown>
  }
  const out = dataset as MutableDataset
  out.value = produced
  attach(dataset, collected)
  return wrapped["~run"](dataset, config)
}

function openContext(original: unknown): {
  readonly issues: Issue[]
  readonly ctx: PreprocessContext
} {
  const issues: Issue[] = []
  const ctx: PreprocessContext = {
    issue(message, severity = "error") {
      issues.push(preprocessIssue(original, message, severity))
    },
  }
  return { issues, ctx }
}

/**
 * Runs `operation` on the raw input, then validates the result with `wrapped`.
 * The operation runs before any validation. A throw becomes a
 * `type: "preprocess"` issue (`Invalid preprocess: …`) and the inner schema
 * does not run. Non-`Error` throws use `String(error)` for the detail.
 * Sync only — an async inner schema or an async operation is a compile-time
 * error (use `preprocessAsync`).
 */
// @__NO_SIDE_EFFECTS__
export function preprocess<TWrapped extends BaseSchema<unknown, unknown>>(
  operation: (input: unknown, ctx: PreprocessContext) => unknown,
  wrapped: TWrapped,
): PreprocessSchema<TWrapped> {
  return {
    kind: "schema",
    type: "preprocess",
    reference: preprocess,
    expects: "unknown",
    async: false,
    wrapped,
    operation,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const original = dataset.value
      const { issues, ctx } = openContext(original)
      try {
        const produced = operation(original, ctx)
        return applyPreprocess(
          dataset,
          original,
          produced,
          issues,
          wrapped,
          config,
        ) as OutputDataset<InferOutput<TWrapped>>
      } catch (error) {
        issues.push(preprocessIssue(original, preprocessThrownMessage(error), "error"))
        halt(dataset, original, issues)
        return dataset as unknown as OutputDataset<InferOutput<TWrapped>>
      }
    },
  }
}
