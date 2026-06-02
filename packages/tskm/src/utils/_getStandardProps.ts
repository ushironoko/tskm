import { defaultConfig } from "../types/config.ts"
import type { OutputDataset } from "../types/dataset.ts"
import type { Issue } from "../types/issue.ts"
import type { BaseSchema, BaseSchemaAsync } from "../types/schema.ts"
import type { StandardSchemaV1 } from "../types/standard.ts"

const VENDOR = "tskm"

const cache: WeakMap<
  object,
  StandardSchemaV1.Props<unknown, unknown>
> = /* @__PURE__ */ new WeakMap()

function toStandardIssue(issue: Issue): StandardSchemaV1.Issue {
  // Our IssuePathItem is already `{ key }`-shaped (the Standard PathSegment form).
  return issue.path ? { message: issue.message, path: issue.path } : { message: issue.message }
}

function toResult(dataset: OutputDataset<unknown>): StandardSchemaV1.Result<unknown> {
  // Success vs failure is decided ONLY by the presence of issues — never by `typed`.
  // A PartialDataset (typed: true, but with refinement issues) is a FAILURE here.
  return dataset.issues ? { issues: dataset.issues.map(toStandardIssue) } : { value: dataset.value }
}

/**
 * Returns the (memoized) Standard Schema props for a schema. Memoization is keyed
 * by the schema object in a module-level WeakMap, so there is no global mutable
 * accumulation (entries are collected with the schema).
 */
export function _getStandardProps<TInput, TOutput>(
  schema: BaseSchema<TInput, TOutput> | BaseSchemaAsync<TInput, TOutput>,
): StandardSchemaV1.Props<TInput, TOutput> {
  const cached = cache.get(schema)
  if (cached) return cached as StandardSchemaV1.Props<TInput, TOutput>

  const props: StandardSchemaV1.Props<TInput, TOutput> = {
    version: 1,
    vendor: VENDOR,
    validate(value: unknown) {
      const dataset = schema["~run"]({ value }, defaultConfig)
      return dataset instanceof Promise
        ? (dataset.then(toResult) as Promise<StandardSchemaV1.Result<TOutput>>)
        : (toResult(dataset) as StandardSchemaV1.Result<TOutput>)
    },
  }
  cache.set(schema, props as StandardSchemaV1.Props<unknown, unknown>)
  return props
}
