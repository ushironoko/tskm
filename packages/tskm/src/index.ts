// ---- Types ----

// ---- Actions ----
export { type Brand, type BrandAction, brand } from "./actions/brand.ts"
export { type CheckAction, check } from "./actions/check.ts"
export { type CheckActionAsync, checkAsync } from "./actions/checkAsync.ts"
export { type EmailAction, email } from "./actions/email.ts"
export { type IntegerAction, integer } from "./actions/integer.ts"
export { type LengthAction, length } from "./actions/length.ts"
export { type MaxLengthAction, maxLength } from "./actions/maxLength.ts"
export { type MaxValueAction, maxValue } from "./actions/maxValue.ts"
export { type MinLengthAction, minLength } from "./actions/minLength.ts"
export { type MinValueAction, minValue } from "./actions/minValue.ts"
export { type MultipleOfAction, multipleOf } from "./actions/multipleOf.ts"
export { type NonEmptyAction, nonEmpty } from "./actions/nonEmpty.ts"
export { type ReadonlyAction, readonly } from "./actions/readonly.ts"
export { type RegexAction, regex } from "./actions/regex.ts"
export { type TransformAction, transform } from "./actions/transform.ts"
export { type TransformActionAsync, transformAsync } from "./actions/transformAsync.ts"
export { type UrlAction, url } from "./actions/url.ts"
// ---- Methods ----
export { assert } from "./methods/assert.ts"
export { type FallbackSchema, fallback } from "./methods/fallback.ts"
export { is } from "./methods/is.ts"
export { parse } from "./methods/parse.ts"
export { parseAsync } from "./methods/parseAsync.ts"
export { pipe, type SchemaWithPipe } from "./methods/pipe.ts"
export { pipeAsync, type SchemaWithPipeAsync } from "./methods/pipeAsync.ts"
export { type SafeParseResult, safeParse } from "./methods/safeParse.ts"
export { type SafeParseAsyncResult, safeParseAsync } from "./methods/safeParseAsync.ts"
// ---- Schemas (sync) ----
export { type AnySchema, any } from "./schemas/anySchema.ts"
export { type ArraySchema, array } from "./schemas/array.ts"
// ---- Schemas (async) ----
export { type ArraySchemaAsync, arrayAsync } from "./schemas/arrayAsync.ts"
export { type BigintSchema, bigint } from "./schemas/bigint.ts"
export { type BooleanSchema, boolean } from "./schemas/boolean.ts"
export { type DateSchema, date } from "./schemas/date.ts"
export { type LazySchema, lazy } from "./schemas/lazy.ts"
export { type Literal, type LiteralSchema, literal } from "./schemas/literal.ts"
export { type NeverSchema, never_ } from "./schemas/neverSchema.ts"
export { type NullableDefault, type NullableSchema, nullable } from "./schemas/nullable.ts"
export { type NullishDefault, type NullishSchema, nullish } from "./schemas/nullish.ts"
export { type NullSchema, null_ } from "./schemas/nullSchema.ts"
export { type NumberSchema, number } from "./schemas/number.ts"
export { type ObjectEntries, type ObjectSchema, object } from "./schemas/object.ts"
export {
  type ObjectEntriesAsync,
  type ObjectSchemaAsync,
  objectAsync,
} from "./schemas/objectAsync.ts"
export { type Default, type OptionalSchema, optional } from "./schemas/optional.ts"
export { type PicklistOptions, type PicklistSchema, picklist } from "./schemas/picklist.ts"
export { type RecordSchema, record } from "./schemas/record.ts"
export { type StringSchema, string } from "./schemas/string.ts"
export {
  type InferTupleInput,
  type InferTupleOutput,
  type TupleItems,
  type TupleSchema,
  tuple,
} from "./schemas/tuple.ts"
export { type UndefinedSchema, undefined_ } from "./schemas/undefinedSchema.ts"
export { type UnionOptions, type UnionSchema, union } from "./schemas/union.ts"
export { type UnknownSchema, unknown } from "./schemas/unknownSchema.ts"
export type { Config } from "./types/config.ts"
export type {
  FailureDataset,
  OutputDataset,
  PartialDataset,
  SuccessDataset,
  UnknownDataset,
} from "./types/dataset.ts"
export type { Infer, InferInput, InferOutput } from "./types/infer.ts"
export type { Issue, IssuePathItem } from "./types/issue.ts"
export type {
  BaseSchema,
  BaseSchemaAsync,
  BaseTransformation,
  BaseValidation,
  GenericSchema,
  GenericSchemaAsync,
  PipeItem,
} from "./types/schema.ts"
export type { StandardSchemaV1 } from "./types/standard.ts"

// ---- Utilities ----
export { isTskmError, type TskmError, tskmError } from "./utils/errors.ts"
export { type FlatErrors, flatten } from "./utils/flatten.ts"
export { getDotPath } from "./utils/getDotPath.ts"
