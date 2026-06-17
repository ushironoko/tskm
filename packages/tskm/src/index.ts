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
export { type TransformAction, type TransformContext, transform } from "./actions/transform.ts"
export { type TransformActionAsync, transformAsync } from "./actions/transformAsync.ts"
export { type UrlAction, url } from "./actions/url.ts"
// ---- Compiled fast path (Tier-0, no-eval; opt-in, experimental) ----
export { type Cursor, getCompiledValidate, type Step, safeParseCompiled } from "./compile.ts"
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
export {
  type DiscriminatedUnionMembers,
  type DiscriminatedUnionSchema,
  discriminatedUnion,
} from "./schemas/discriminatedUnion.ts"
export {
  type DiscriminatedUnionMembersAsync,
  type DiscriminatedUnionSchemaAsync,
  discriminatedUnionAsync,
} from "./schemas/discriminatedUnionAsync.ts"
export { type LazySchema, lazy } from "./schemas/lazy.ts"
export { type Literal, type LiteralSchema, literal } from "./schemas/literal.ts"
export { type NeverSchema, never_ } from "./schemas/neverSchema.ts"
export { type NullableDefault, type NullableSchema, nullable } from "./schemas/nullable.ts"
export { type NullishDefault, type NullishSchema, nullish } from "./schemas/nullish.ts"
export { type NullSchema, null_ } from "./schemas/nullSchema.ts"
export { type NumberSchema, number } from "./schemas/number.ts"
export {
  exactObject,
  type ObjectEntries,
  type ObjectOptions,
  type ObjectSchema,
  object,
  type RestMode,
} from "./schemas/object.ts"
export {
  exactObjectAsync,
  type ObjectEntriesAsync,
  type ObjectOptionsAsync,
  type ObjectSchemaAsync,
  objectAsync,
} from "./schemas/objectAsync.ts"
export { type Default, type OptionalSchema, optional } from "./schemas/optional.ts"
export { type PicklistOptions, type PicklistSchema, picklist } from "./schemas/picklist.ts"
export { type RecordSchema, record } from "./schemas/record.ts"
export { type RecordKeyAsync, type RecordSchemaAsync, recordAsync } from "./schemas/recordAsync.ts"
export { type RecursiveBuild, type RecursiveSchema, recursive } from "./schemas/recursive.ts"
export { type StringSchema, string } from "./schemas/string.ts"
export {
  type InferTemplateLiteral,
  type TemplateLiteralSchema,
  type TemplatePart,
  type TemplateParts,
  templateLiteral,
} from "./schemas/templateLiteral.ts"
export {
  type InferTupleInput,
  type InferTupleOutput,
  type TupleItems,
  type TupleSchema,
  tuple,
} from "./schemas/tuple.ts"
export { type UndefinedSchema, undefined_ } from "./schemas/undefinedSchema.ts"
export { type UnionOptions, type UnionSchema, union } from "./schemas/union.ts"
export {
  type UnionOptionsAsync,
  type UnionSchemaAsync,
  unionAsync,
} from "./schemas/unionAsync.ts"
export { type UnknownSchema, unknown } from "./schemas/unknownSchema.ts"
export { type Config, isReject, type ParseMode } from "./types/config.ts"
export type {
  FailureDataset,
  OutputDataset,
  PartialDataset,
  SuccessDataset,
  UnknownDataset,
} from "./types/dataset.ts"
export type { Infer, InferInput, InferOutput } from "./types/infer.ts"
export type { Issue, IssuePathItem, IssueSeverity } from "./types/issue.ts"
export type {
  BaseSchema,
  BaseSchemaAsync,
  BaseTransformation,
  BaseValidation,
  GenericSchema,
  GenericSchemaAsync,
  PipeItem,
  StandardProps,
} from "./types/schema.ts"
export type { StandardSchemaV1 } from "./types/standard.ts"

// ---- Utilities ----
export { isTskmError, type TskmError, tskmError } from "./utils/errors.ts"
export { type FlatErrors, flatten } from "./utils/flatten.ts"
export { getDotPath } from "./utils/getDotPath.ts"
