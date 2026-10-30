import type { Config } from "../types/config.ts"
import type { MutableDataset, OutputDataset, UnknownDataset } from "../types/dataset.ts"
import type { InferOutput } from "../types/infer.ts"
import type { Issue } from "../types/issue.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { isErrorIssue } from "../utils/_severity.ts"
import { type PreprocessContext, preprocessIssue, preprocessThrownMessage } from "./preprocess.ts"

type AnyWrapped = BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>

/**
 * Async counterpart of `PreprocessSchema`. The input type is `unknown`. The
 * output type is the inner schema's output. A rejection is recorded the same
 * way as a sync throw: `Invalid preprocess: …`, inner schema not run.
 * Non-`Error` rejections use `String(error)`.
 */
export interface PreprocessSchemaAsync<TWrapped extends AnyWrapped>
  extends BaseSchemaAsync<unknown, InferOutput<TWrapped>> {
  readonly type: "preprocess"
  readonly reference: typeof preprocessAsync
  readonly wrapped: TWrapped
  readonly operation: (input: unknown, ctx: PreprocessContext) => unknown | Promise<unknown>
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

async function applyPreprocessAsync(
  dataset: UnknownDataset,
  original: unknown,
  produced: unknown,
  collected: readonly Issue[],
  wrapped: AnyWrapped,
  config: Config,
): Promise<OutputDataset<unknown>> {
  if (collected.some(isErrorIssue)) {
    halt(dataset, original, collected)
    return dataset as unknown as OutputDataset<unknown>
  }
  const out = dataset as MutableDataset
  out.value = produced
  attach(dataset, collected)
  return wrapped["~run"](dataset, config)
}

/**
 * Async preprocess. Accepts a sync or async inner schema and an operation that
 * may return a promise. Rejections and synchronous throws inside the operation
 * become preprocess issues; they do not escape `parseAsync`.
 */
// @__NO_SIDE_EFFECTS__
export function preprocessAsync<TWrapped extends AnyWrapped>(
  operation: (input: unknown, ctx: PreprocessContext) => unknown | Promise<unknown>,
  wrapped: TWrapped,
): PreprocessSchemaAsync<TWrapped> {
  return {
    kind: "schema",
    type: "preprocess",
    reference: preprocessAsync,
    expects: "unknown",
    async: true,
    wrapped,
    operation,
    get "~standard"() {
      return _getStandardProps(this)
    },
    async "~run"(dataset, config) {
      const original = dataset.value
      const issues: Issue[] = []
      const ctx: PreprocessContext = {
        issue(message, severity = "error") {
          issues.push(preprocessIssue(original, message, severity))
        },
      }
      try {
        const produced = await operation(original, ctx)
        return applyPreprocessAsync(
          dataset,
          original,
          produced,
          issues,
          wrapped,
          config,
        ) as Promise<OutputDataset<InferOutput<TWrapped>>>
      } catch (error) {
        issues.push(preprocessIssue(original, preprocessThrownMessage(error), "error"))
        halt(dataset, original, issues)
        return dataset as unknown as OutputDataset<InferOutput<TWrapped>>
      }
    },
  }
}
