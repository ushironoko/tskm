import type { OutputDataset } from "../types/dataset.ts"
import type { Issue, IssueSeverity } from "../types/issue.ts"
import type { BaseTransformation } from "../types/schema.ts"
import { _received } from "../utils/_received.ts"
import { isErrorIssue } from "../utils/_severity.ts"

/**
 * The diagnostic channel handed to a transform operation. Calling `issue` records a
 * diagnostic on the parse without throwing and without closure-captured side effects. The default severity is `"error"`; pass `"warning"` to
 * report a non-fatal observation that keeps the parse successful. Existing `(input) => output` operations simply ignore this argument.
 */
export interface TransformContext {
  issue(message: string, severity?: IssueSeverity): void
}

export interface TransformAction<TInput, TOutput> extends BaseTransformation<TInput, TOutput> {
  readonly type: "transform"
  readonly reference: typeof transform
  readonly operation: (input: TInput, ctx: TransformContext) => TOutput
}

// @__NO_SIDE_EFFECTS__
export function transform<TInput, TOutput>(
  operation: (input: TInput, ctx: TransformContext) => TOutput,
): TransformAction<TInput, TOutput> {
  return {
    kind: "transformation",
    type: "transform",
    reference: transform,
    async: false,
    operation,
    "~run"(dataset) {
      const mutable = dataset as { value: unknown; typed?: boolean; issues?: Issue[] }
      const collected: Issue[] = []
      const ctx: TransformContext = {
        issue(message, severity = "error") {
          collected.push({
            kind: "transformation",
            type: "transform",
            expected: null,
            received: _received(mutable.value),
            message,
            input: mutable.value,
            severity,
          })
        },
      }
      // The dataset stays typed; only its value is mapped to the new shape.
      mutable.value = operation(dataset.value, ctx)
      if (collected.length > 0) {
        mutable.issues = mutable.issues ? [...mutable.issues, ...collected] : collected
        // An error untypes the dataset; a warning leaves the value valid and present.
        if (collected.some(isErrorIssue)) {
          mutable.typed = false
        }
      }
      return dataset as unknown as OutputDataset<TOutput>
    },
  }
}
