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
 * The `number` fragment is an approximation: it matches the decimal/exponent forms but not
 * hex/binary/octal or `Infinity`/`NaN` shapes, which the `${number}` type can also denote.
 */
function placeholderFragment(schema: BaseSchema<unknown, unknown>): string {
  const node = schema as {
    type?: unknown
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
