import { defaultConfig } from "../types/config.ts"
import type { OutputDataset } from "../types/dataset.ts"
import type { Issue } from "../types/issue.ts"
import type { BaseSchema, BaseSchemaAsync, StandardProps } from "../types/schema.ts"
import type { StandardSchemaV1 } from "../types/standard.ts"
import { isErrorIssue } from "./_severity.ts"

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
  // Failure is decided ONLY by ERROR-severity issues, never by `typed`. A `"warning"`
  // is not a Standard Schema failure, so it is excluded from the external `issues` array
  // (and severity itself never crosses this boundary). A dataset carrying only warnings
  // is a SUCCESS here.
  const errors = dataset.issues?.filter(isErrorIssue)
  return errors && errors.length > 0
    ? { issues: errors.map(toStandardIssue) }
    : { value: dataset.value }
}

/**
 * Returns the (memoized) Standard Schema props for a schema. Memoization is keyed
 * by the schema object in a module-level WeakMap, so there is no global mutable
 * accumulation (entries are collected with the schema).
 */
export function _getStandardProps<TInput, TOutput>(
  schema: BaseSchema<TInput, TOutput> | BaseSchemaAsync<TInput, TOutput>,
): StandardProps<TInput, TOutput> {
  const cached = cache.get(schema)
  if (cached) return cached as StandardProps<TInput, TOutput>

  // This is a DELIBERATE unsound widening. The runtime object never carries `types`
  // (it is a Standard Schema phantom, type-level only; issue #20 keeps the runtime shape
  // version/vendor/validate), yet `StandardProps` claims `types` present. So `Props`
  // (no required `types`) is NOT assignable to `StandardProps`. That is exactly the
  // gap the assertion bridges, and consumers must never read `~standard.types` at
  // runtime (see StandardProps). A single `as` (not `as unknown as`) is accepted only
  // because the reverse holds (`StandardProps` IS assignable to `Props`), which makes
  // the two types mutually comparable.
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
  return props as StandardProps<TInput, TOutput>
}
