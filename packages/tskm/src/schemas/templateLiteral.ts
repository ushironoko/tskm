import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import { bigint } from "./bigint.ts"
import { boolean } from "./boolean.ts"
import { literal } from "./literal.ts"
import { never_ } from "./neverSchema.ts"
import { nullable } from "./nullable.ts"
import { nullish } from "./nullish.ts"
import { null_ } from "./nullSchema.ts"
import { number } from "./number.ts"
import { optional } from "./optional.ts"
import { picklist } from "./picklist.ts"
import { string } from "./string.ts"
import { undefined_ } from "./undefinedSchema.ts"
import { union } from "./union.ts"

/** The value types TypeScript allows to be interpolated into a template literal type. */
type TemplatePrimitive = string | number | bigint | boolean | null | undefined

/** A part of a template literal: a fixed string segment or a placeholder schema. */
export type TemplatePart = string | BaseSchema<unknown, TemplatePrimitive>

export type TemplateParts = readonly TemplatePart[]

/** The literal/output type a single part contributes to the concatenation. */
type PartOutput<P> = P extends string
  ? P
  : P extends BaseSchema<unknown, infer O>
    ? O extends TemplatePrimitive
      ? O
      : string
    : never

/** Folds the parts into a TypeScript template literal type. Unions distribute naturally. */
type Concat<Parts extends TemplateParts> = Parts extends readonly [
  infer Head,
  ...infer Tail extends TemplateParts,
]
  ? `${PartOutput<Head> & TemplatePrimitive}${Concat<Tail>}`
  : ""

export type InferTemplateLiteral<Parts extends TemplateParts> = Concat<Parts>

export interface TemplateLiteralSchema<Parts extends TemplateParts>
  extends BaseSchema<InferTemplateLiteral<Parts>, InferTemplateLiteral<Parts>> {
  readonly type: "templateLiteral"
  readonly reference: typeof templateLiteral
  readonly parts: Parts
  /** The anchored regex source matched at runtime, reused by the JSON Schema emitter. */
  readonly pattern: string
  readonly message: string | undefined
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g

function escapeRegex(text: string): string {
  return text.replace(REGEX_META, "\\$&")
}

/** A char class that matches no character, so the placeholder can never be filled. */
const NEVER_MATCH = "[^\\s\\S]"

/**
 * Hex/binary/octal integer string forms. Verified with the project's tsgo: each is a member
 * of both `` `${number}` `` and `` `${bigint}` `` (e.g. `"0x10"`, `"0b10"`, `"0o17"`), while a
 * NEGATIVE radix (`"-0x10"`) is not a `${number}` member, so this only covers the positive
 * forms to stay a sound subset.
 */
const RADIX_INT = "0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+"

/**
 * The tskm factory that legitimately produces each supported placeholder `type`. A schema's
 * `reference` is its self-identity (see `BaseSchema.reference`); requiring it to match the
 * factory for its claimed `type` closes the structural-trust gap where a forged or foreign
 * object sets a known `type` string ("string", "number", …) it does not actually implement.
 * Without the check that object would receive the type's permissive fragment and accept
 * values outside the inferred template-literal type. A pipe spreads its base schema, so a
 * validation-only pipe keeps the base `reference` and still matches. (A determined caller who
 * copies a real factory onto a lying object is out of scope: they'd have to import the very
 * factory they subvert.) This is a constant lookup table, never mutated.
 */
const REFERENCE_BY_TYPE = new Map<string, unknown>([
  ["string", string],
  ["number", number],
  ["bigint", bigint],
  ["boolean", boolean],
  ["null", null_],
  ["undefined", undefined_],
  ["never", never_],
  ["literal", literal],
  ["picklist", picklist],
  ["union", union],
  ["optional", optional],
  ["nullable", nullable],
  ["nullish", nullish],
])

/**
 * The exact regex text for a `literal`/`picklist` option. A finite value's `String()` form is
 * its `${…}` template form, so the fragment matches it precisely. A non-finite number
 * (`Infinity`/`-Infinity`/`NaN`) is rejected: it has no literal type, so it widens its
 * placeholder's output type to `number`, yet its string form ("Infinity"/"NaN") is not a
 * member of `${number}` — no fragment can match both, so fail closed at construction rather
 * than emit one that diverges from the inferred type.
 */
function literalOptionFragment(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(
      `templateLiteral: a non-finite numeric placeholder (${String(value)}) cannot be bounded by a regex; its output type widens to \`number\` while its string form is outside \`\${number}\``,
    )
  }
  return escapeRegex(String(value))
}

/**
 * True if a placeholder carries a transformation anywhere in its pipe chain. `pipe(base, …)`
 * spreads `base`, so a pipe's surface `type` is the BASE schema's type while its OUTPUT type
 * is the transformed one. Computing a regex from `type` would then accept values outside the
 * inferred template-literal type. The walk descends into every `pipe` entry — crucially
 * `pipe[0]`, the base, which can itself be a transforming pipe — so a nested transform behind
 * an otherwise validation-only outer pipe is not missed. A validation-only pipe carries no
 * transformation, leaves the output type equal to the base, and stays allowed.
 *
 * The whole `kind: "transformation"` is rejected, including the runtime-identity refinements
 * `readonly`/`brand` that happen to preserve the value. Exempting them would mean maintaining
 * a per-action allowlist that any future transformation could silently slip through; rejecting
 * the kind keeps the rule fail-closed and self-maintaining on a soundness-critical path, at the
 * cost of two contrived placeholders with no runtime meaning inside a regex.
 */
function hasTransformation(node: { pipe?: unknown }): boolean {
  const items = node.pipe
  if (!Array.isArray(items)) return false
  return items.some((item) => {
    const entry = item as { kind?: unknown; pipe?: unknown }
    return entry.kind === "transformation" || hasTransformation(entry)
  })
}

/**
 * The regex fragment a placeholder schema contributes, kept as tight as the placeholder's
 * OUTPUT type so the runtime never accepts a string the inferred template literal type
 * rejects. Enumerable placeholders become precise alternations (an empty set matches
 * nothing); `string` is a lazy any-match so the surrounding precise parts drive the
 * boundary finding; the wrappers unwrap to their inner fragment plus the null/undefined
 * literal text they add. An unsupported placeholder is a construction error rather than a
 * silent any-match, so a placeholder kind whose strings the regex cannot bound is rejected
 * up front instead of diverging from the type.
 *
 * The `number`/`bigint` fragments match the decimal, exponent, and hex/binary/octal integer
 * forms that `${number}`/`${bigint}` denote (verified against the project's tsgo). `Infinity`
 * and `NaN` are NOT members of `${number}`, so the fragments correctly exclude them and a
 * non-finite numeric `literal` is rejected up front.
 */
function placeholderFragment(schema: BaseSchema<unknown, unknown>): string {
  const node = schema as {
    type?: unknown
    reference?: unknown
    literal?: unknown
    options?: unknown
    wrapped?: unknown
    pipe?: unknown
  }
  // Fail closed on a transforming placeholder before reading `type`: the pipe's surface
  // `type` is the base schema's, so a regex computed from it would diverge from the
  // placeholder's transformed OUTPUT type. Wrapper/union branches re-enter this function,
  // so a transform nested inside `optional`/`union`/etc. is caught on re-entry.
  if (hasTransformation(node)) {
    throw new Error(
      "templateLiteral: a transforming placeholder cannot be bounded by a regex; its runtime match would diverge from the inferred template-literal type. Use the schema the transform produces (e.g. `picklist`/`literal`) as the placeholder instead.",
    )
  }
  // Reject a forged/foreign placeholder that claims a supported `type` but is not tskm's own
  // schema for it (its `reference` would not match). Without this the fragment is built from a
  // `type` the object does not faithfully implement. Unknown types fall through to the switch's
  // `default`, which throws anyway.
  const expectedReference = REFERENCE_BY_TYPE.get(String(node.type))
  if (expectedReference !== undefined && node.reference !== expectedReference) {
    throw new Error(
      `templateLiteral: placeholder claims type "${String(node.type)}" but is not tskm's own schema for it; a forged or foreign schema cannot be soundly bounded. Construct the placeholder with tskm's factory.`,
    )
  }
  switch (node.type) {
    case "string":
      return "[\\s\\S]*?"
    case "number":
      return `(?:${RADIX_INT}|[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)`
    case "bigint":
      // `${bigint}` excludes a leading `+` and (decimal) leading zeros, but includes the
      // hex/binary/octal integer forms.
      return `(?:${RADIX_INT}|-?(?:0|[1-9]\\d*))`
    case "boolean":
      return "(?:true|false)"
    case "null":
      return "null"
    case "undefined":
      return "undefined"
    case "never":
      return NEVER_MATCH
    case "literal":
      return literalOptionFragment(node.literal)
    case "picklist":
      return Array.isArray(node.options) && node.options.length > 0
        ? `(?:${node.options.map((option) => literalOptionFragment(option)).join("|")})`
        : NEVER_MATCH
    case "union":
      return Array.isArray(node.options) && node.options.length > 0
        ? `(?:${node.options
            .map((option) => placeholderFragment(option as BaseSchema<unknown, unknown>))
            .join("|")})`
        : NEVER_MATCH
    case "optional":
      // The output adds `undefined`, whose string form is the literal "undefined".
      return `(?:${placeholderFragment(node.wrapped as BaseSchema<unknown, unknown>)}|undefined)`
    case "nullable":
      return `(?:${placeholderFragment(node.wrapped as BaseSchema<unknown, unknown>)}|null)`
    case "nullish":
      return `(?:${placeholderFragment(node.wrapped as BaseSchema<unknown, unknown>)}|null|undefined)`
    default:
      throw new Error(
        `templateLiteral: unsupported placeholder schema "${String(node.type)}"; use a string/number/bigint/boolean/literal/picklist/union/null/undefined placeholder`,
      )
  }
}

function partExpects(part: TemplatePart): string {
  return typeof part === "string" ? part : `\${${part.expects}}`
}

/**
 * Builds a template-literal schema. Validation is a synchronous regex test, so there is
 * no async counterpart (primitive contract, section 3): an async variant would add no
 * capability.
 */
// @__NO_SIDE_EFFECTS__
export function templateLiteral<const Parts extends TemplateParts>(
  parts: Parts,
  message?: string,
): TemplateLiteralSchema<Parts> {
  let pattern = "^"
  for (const part of parts) {
    pattern += typeof part === "string" ? escapeRegex(part) : placeholderFragment(part)
  }
  pattern += "$"
  const matcher = new RegExp(pattern)
  const expects = `\`${parts.map(partExpects).join("")}\``

  return {
    kind: "schema",
    type: "templateLiteral",
    reference: templateLiteral,
    expects,
    async: false,
    parts,
    pattern,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      if (typeof out.value === "string" && matcher.test(out.value)) {
        out.typed = true
      } else {
        _addIssue(
          dataset,
          { kind: "schema", type: "templateLiteral", expected: expects, message },
          config,
        )
      }
      return out as unknown as OutputDataset<InferTemplateLiteral<Parts>>
    },
  }
}
