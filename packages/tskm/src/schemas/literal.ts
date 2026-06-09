import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

export type Literal = string | number | boolean

export interface LiteralSchema<T extends Literal> extends BaseSchema<T, T> {
  readonly type: "literal"
  readonly reference: typeof literal
  readonly literal: T
  readonly message: string | undefined
}

// @__NO_SIDE_EFFECTS__
export function literal<const T extends Literal>(value: T, message?: string): LiteralSchema<T> {
  // Compute the expected string once at construction so the failing-parse branch
  // reuses it instead of rebuilding the same template literal on every parse.
  const expected = typeof value === "string" ? `"${value}"` : `${value}`
  return {
    kind: "schema",
    type: "literal",
    reference: literal,
    expects: expected,
    async: false,
    literal: value,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (out.value === value) {
        out.typed = true
      } else {
        _addIssue(
          dataset,
          {
            kind: "schema",
            type: "literal",
            expected,
            message,
          },
          config,
        )
      }
      return out as unknown as OutputDataset<T>
    },
  }
}
