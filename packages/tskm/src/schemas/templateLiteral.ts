import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

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
 * The regex fragment a placeholder schema contributes, kept as tight as the placeholder's
 * OUTPUT type so the runtime never accepts a string the inferred template literal type
 * rejects. Enumerable placeholders become precise alternations (an empty set matches
 * nothing); `string` is a lazy any-match so the surrounding precise parts drive the
 * boundary finding; the wrappers unwrap to their inner fragment plus the null/undefined
 * literal text they add. An unsupported placeholder is a construction error rather than a
 * silent any-match, so a placeholder kind whose strings the regex cannot bound is rejected
 * up front instead of diverging from the type.
 *
 * The `number` fragment is an approximation: it matches the decimal/exponent forms but not
 * hex/binary/octal or `Infinity`/`NaN` shapes, which the `${number}` type can also denote.
 */
function placeholderFragment(schema: BaseSchema<unknown, unknown>): string {
  const node = schema as {
    type?: unknown
    literal?: unknown
    options?: unknown
    wrapped?: unknown
  }
  switch (node.type) {
    case "string":
      return "[\\s\\S]*?"
    case "number":
      return "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?"
    case "bigint":
      // `${bigint}` excludes a leading `+` and leading zeros.
      return "-?(?:0|[1-9]\\d*)"
    case "boolean":
      return "(?:true|false)"
    case "null":
      return "null"
    case "undefined":
      return "undefined"
    case "never":
      return NEVER_MATCH
    case "literal":
      return escapeRegex(String(node.literal))
    case "picklist":
      return Array.isArray(node.options) && node.options.length > 0
        ? `(?:${node.options.map((option) => escapeRegex(String(option))).join("|")})`
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
