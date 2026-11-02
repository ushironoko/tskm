import type { BigintSchema } from "./bigint.ts"
import { bigint } from "./bigint.ts"
import type { BooleanSchema } from "./boolean.ts"
import { boolean } from "./boolean.ts"
import type { DateSchema } from "./date.ts"
import { date } from "./date.ts"
import type { NumberSchema } from "./number.ts"
import { number } from "./number.ts"
import { type PreprocessSchema, preprocess } from "./preprocess.ts"
import type { StringSchema } from "./string.ts"
import { string } from "./string.ts"

/**
 * Zod-compatible constructors. Each helper is `preprocess` around the matching
 * primitive, so the schema `type` is `"preprocess"` and the output type is the
 * primitive. `pipe(coerce.number(), minValue(1))` validates the coerced number.
 *
 * These coerce every input, not only strings. `Number("") === 0`,
 * `Number(true) === 1`, `Number(null) === 0`, `String(null) === "null"`, and
 * `new Date(null)` is the epoch. A thrown constructor (`BigInt` of a non-integer)
 * becomes a preprocess issue.
 */
// @__NO_SIDE_EFFECTS__
function coerceString(message?: string): PreprocessSchema<StringSchema> {
  return preprocess((value) => String(value), string(message))
}

// @__NO_SIDE_EFFECTS__
function coerceNumber(message?: string): PreprocessSchema<NumberSchema> {
  return preprocess((value) => Number(value), number(message))
}

/**
 * `Boolean(value)`, matching Zod's `z.coerce.boolean()`.
 * `Boolean("false") === true` — any non-empty string is `true`, including
 * `"false"`. String flags need `preprocess` instead:
 *
 * ```ts
 * preprocess((value) => {
 *   if (typeof value !== "string") return value
 *   return value === "true" || value === "1"
 * }, boolean())
 * ```
 */
// @__NO_SIDE_EFFECTS__
function coerceBoolean(message?: string): PreprocessSchema<BooleanSchema> {
  return preprocess((value) => Boolean(value), boolean(message))
}

// @__NO_SIDE_EFFECTS__
function coerceBigint(message?: string): PreprocessSchema<BigintSchema> {
  return preprocess((value) => BigInt(value as string | number | bigint | boolean), bigint(message))
}

// @__NO_SIDE_EFFECTS__
function coerceDate(message?: string): PreprocessSchema<DateSchema> {
  return preprocess((value) => new Date(value as string | number | Date), date(message))
}

export const coerce: {
  readonly string: typeof coerceString
  readonly number: typeof coerceNumber
  /**
   * `Boolean(value)`, matching Zod's `z.coerce.boolean()`.
   * `Boolean("false") === true` — any non-empty string is `true`, including
   * `"false"`. String flags need `preprocess` instead:
   *
   * ```ts
   * preprocess((value) => {
   *   if (typeof value !== "string") return value
   *   return value === "true" || value === "1"
   * }, boolean())
   * ```
   */
  readonly boolean: typeof coerceBoolean
  readonly bigint: typeof coerceBigint
  readonly date: typeof coerceDate
} = {
  string: coerceString,
  number: coerceNumber,
  boolean: coerceBoolean,
  bigint: coerceBigint,
  date: coerceDate,
}
