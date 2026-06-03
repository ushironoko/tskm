import { type CycleGuardState, createCycleGuard, walkWithCycleGuard } from "./cycle-guard.ts"

/**
 * Structural TS-type emitter for RECURSIVE schemas.
 *
 * The plain tsgo `InferOutput<typeof X>` query cannot materialize a recursive
 * schema's output type — the value-level self-reference collapses to `any`/`unknown`
 * before the checker ever sees it. This walker takes the other route: it walks the
 * RUNTIME schema object graph (duck-typed, like `jsonschema.ts`) through the shared
 * identity-keyed cycle guard and renders a TS type body directly, turning a
 * back-edge into the alias name the sidecar declares (`Category`), which TypeScript
 * handles natively as a self-referential type alias.
 *
 * Two honest limits, both surfaced rather than silently mistyped:
 * - A transform's output type lives only in the checker, so a transform under a
 *   recursive root renders `unknown` here (the Tier-2 floor) with a path-precise
 *   warning; `bearsOpaque` routes the root to the sentinel-unroll checker query
 *   (Tier-1) that can resolve the real output type.
 * - A cycle through a value with no exported name (anonymous inner cycles, or a
 *   getter that defeats the identity guard) cannot be named in a single type alias;
 *   the result is flagged `unsupported` and the caller skips emission (status quo).
 */

export interface SchemaToTypeOptions {
  /** The alias name this root is emitted under (discovery's `typeName`). */
  readonly rootName: string
  /**
   * Identity map: exported schema object -> its emitted alias name (the single
   * naming source, derived once via `deriveTypeName`). Must include the root.
   * References to OTHER exported schemas short-circuit to their alias name, which
   * is what makes same-file mutual recursion render as cross-referencing aliases.
   */
  readonly typeNames: ReadonlyMap<object, string>
  /** Depth fallback for cycles the identity guard cannot see (default 64). */
  readonly maxDepth?: number
}

export interface StructuralTypeResult {
  /** The Tier-2 skeleton body for the root alias (opaque positions as `unknown`). */
  readonly typeString: string
  /** True when a transform sat anywhere under the root (routes to the Tier-1 unroll). */
  readonly bearsOpaque: boolean
  /** Path-precise diagnostic addresses of the opaque positions. */
  readonly opaquePaths: ReadonlyArray<string>
  /** Own data-property keys of the root body (structural side of the brand cross-check). */
  readonly dataKeys: ReadonlyArray<string>
  /** True when the walk met an unnameable cycle (anonymous node or depth fallback). */
  readonly unsupported: boolean
  readonly warnings: ReadonlyArray<string>
}

/**
 * One worker-envelope entry: the walk result plus the export identity. Declared
 * HERE (single source) and imported by both ends of the process boundary so the
 * worker and the parent cannot drift apart.
 */
export interface StructuralWorkerEntry extends StructuralTypeResult {
  /** The export binding name (matches `DiscoveredSchema.name`). */
  readonly name: string
  readonly typeName: string
  /** True when the runtime object is a `recursive()` root. */
  readonly recursive: boolean
}

/** A duck-typed view of a runtime tskm schema object. */
type SchemaLike = { readonly type?: unknown; readonly pipe?: unknown; [key: string]: unknown }

interface WalkContext {
  readonly rootName: string
  readonly root: object
  readonly typeNames: ReadonlyMap<object, string>
  readonly guard: CycleGuardState
  readonly defs: Record<string, string>
  readonly warnings: string[]
  readonly opaquePaths: string[]
  /** Diagnostic path segments from the root to the node being walked. */
  readonly path: string[]
  readonly maxDepth: number
  depth: number
  unsupported: boolean
}

function isObject(value: unknown): value is SchemaLike {
  return value !== null && typeof value === "object"
}

const DEFAULT_MAX_DEPTH = 64

/** Pure walker: a runtime tskm schema object -> a single-line TS type body. */
export function schemaToTypeString(
  schema: unknown,
  options: SchemaToTypeOptions,
): StructuralTypeResult {
  const ctx: WalkContext = {
    rootName: options.rootName,
    root: isObject(schema) ? schema : {},
    typeNames: options.typeNames,
    guard: createCycleGuard(),
    defs: {},
    warnings: [],
    opaquePaths: [],
    path: [],
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    depth: 0,
    unsupported: false,
  }
  const out = walkNode(schema, ctx)
  // When the root participated in its own cycle it was hoisted under its alias name;
  // the deposited body IS the alias body. Acyclic roots simply inline.
  const typeString = ctx.defs[options.rootName] ?? out
  return {
    typeString,
    bearsOpaque: ctx.opaquePaths.length > 0,
    opaquePaths: ctx.opaquePaths,
    dataKeys: rootDataKeys(schema),
    unsupported: ctx.unsupported,
    warnings: ctx.warnings,
  }
}

function currentPath(ctx: WalkContext): string {
  return `${ctx.rootName}${ctx.path.join("")}`
}

function walkChild(schema: unknown, segment: string, ctx: WalkContext): string {
  ctx.path.push(segment)
  try {
    return walkNode(schema, ctx)
  } finally {
    ctx.path.pop()
  }
}

function walkNode(schema: unknown, ctx: WalkContext): string {
  if (!isObject(schema)) {
    ctx.warnings.push(
      `tskm: ${ctx.rootName}: cannot type a non-object schema at ${currentPath(ctx)}; emitted 'unknown'.`,
    )
    return "unknown"
  }

  // A reference to ANOTHER exported schema renders as its alias name — its own
  // declaration is emitted separately (checker path or its own structural walk).
  if (schema !== ctx.root) {
    const alias = ctx.typeNames.get(schema)
    if (alias !== undefined) {
      return alias
    }
  }

  // Depth fallback: a getter that returns a fresh body per call defeats the identity
  // guard, so the cycle is unnameable — stop instead of hanging, and mark the whole
  // root unsupported (the skeleton cannot be trusted).
  if (ctx.depth >= ctx.maxDepth) {
    ctx.unsupported = true
    ctx.warnings.push(
      `tskm: ${ctx.rootName}: max walk depth exceeded at ${currentPath(ctx)} (a cycle the identity guard cannot see); skipped.`,
    )
    return "unknown"
  }

  ctx.depth++
  try {
    return walkWithCycleGuard<string>(schema, ctx.guard, {
      emitRef: (name) => name,
      storeDef: (name, body) => {
        ctx.defs[name] = body
      },
      hasDef: (name) => name in ctx.defs,
      baseName: (target) => {
        const named = ctx.typeNames.get(target)
        if (named !== undefined) {
          return named
        }
        // A cycle through a value with no exported name cannot be expressed as a
        // sibling alias in v1 — flag it; the caller skips emission (status quo).
        ctx.unsupported = true
        ctx.warnings.push(
          `tskm: ${ctx.rootName}: cycle through a value with no exported name at ${currentPath(ctx)} cannot be materialized in v1; skipped.`,
        )
        return "__TskmAnon"
      },
      walkBody: (target) => {
        const t = target as SchemaLike
        return Array.isArray(t.pipe)
          ? walkPipe(t as SchemaLike & { pipe: unknown[] }, ctx)
          : walkSchema(t, ctx)
      },
    })
  } finally {
    ctx.depth--
  }
}

function walkSchema(schema: SchemaLike, ctx: WalkContext): string {
  const type = schema.type
  switch (type) {
    case "string":
      return "string"
    case "number":
      return "number"
    case "boolean":
      return "boolean"
    case "bigint":
      return "bigint"
    case "date":
      return "Date"
    case "null":
      return "null"
    case "undefined":
      return "undefined"
    case "any":
      return "any"
    case "unknown":
      return "unknown"
    case "never":
      return "never"
    case "literal":
      return renderLiteral(schema.literal)
    case "picklist": {
      const options = Array.isArray(schema.options) ? schema.options : []
      return options.length === 0 ? "never" : options.map(renderLiteral).join(" | ")
    }
    case "object":
      return walkObject(schema, ctx)
    case "array":
      return `${parenthesizeIfCompound(walkChild(schema.item, ".item", ctx))}[]`
    case "record":
      // An index-signature literal, NOT `Record<string, V>`: type arguments to
      // another alias are resolved eagerly, so `Record` would make a
      // self-referential alias circular (TS2456). The literal form is deferred
      // (legal) and matches how tsgo itself renders these types.
      return `{ [key: string]: ${walkChild(schema.value, ".value", ctx)} }`
    case "tuple": {
      const items = Array.isArray(schema.items) ? schema.items : []
      return `[${items.map((item, i) => walkChild(item, `.items[${i}]`, ctx)).join(", ")}]`
    }
    case "union": {
      const options = Array.isArray(schema.options) ? schema.options : []
      return options.length === 0
        ? "never"
        : options.map((option, i) => walkChild(option, `.options[${i}]`, ctx)).join(" | ")
    }
    case "optional":
      return `${walkChild(schema.wrapped, ".wrapped", ctx)} | undefined`
    case "nullable":
      return `${walkChild(schema.wrapped, ".wrapped", ctx)} | null`
    case "nullish":
      return `${walkChild(schema.wrapped, ".wrapped", ctx)} | null | undefined`
    case "lazy":
    case "recursive": {
      // Both defer the body behind a memoized getter; the cycle guard keys on object
      // identity (for `recursive`, the schema object IS the `self` placeholder), so
      // back-edges terminate as alias names instead of recursing forever.
      const getter = schema.getter
      if (typeof getter !== "function") {
        ctx.warnings.push(
          `tskm: ${ctx.rootName}: ${String(type)} schema has no getter at ${currentPath(ctx)}; emitted 'unknown'.`,
        )
        return "unknown"
      }
      return walkNode((getter as () => unknown)(), ctx)
    }
    default:
      ctx.warnings.push(
        `tskm: ${ctx.rootName}: unknown schema type "${String(type)}" at ${currentPath(ctx)}; emitted 'unknown'.`,
      )
      return "unknown"
  }
}

function walkObject(schema: SchemaLike, ctx: WalkContext): string {
  const entries = isObject(schema.entries) ? schema.entries : {}
  const fields: string[] = []
  for (const key of Object.keys(entries)) {
    const entry = entries[key]
    const entryType = isObject(entry) ? entry.type : undefined
    const optionalKey = entryType === "optional" || entryType === "nullish"
    const rendered = walkChild(entry, `.entries[${key}]`, ctx)
    fields.push(`${renderKey(key)}${optionalKey ? "?" : ""}: ${rendered}`)
  }
  return fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`
}

/**
 * Folds pipe items onto the base type. Validations never change the type; `brand`
 * wraps the accumulated type in a self-contained nominal intersection; any other
 * transformation's output type lives only in the checker, so it degrades to the
 * Tier-2 `unknown` floor here and flips `bearsOpaque` (Tier-1's routing bit).
 */
function walkPipe(schema: SchemaLike & { pipe: unknown[] }, ctx: WalkContext): string {
  const [base, ...items] = schema.pipe
  let acc = walkChild(base, ".pipe[0]", ctx)
  for (const [i, rawItem] of items.entries()) {
    if (!isObject(rawItem)) {
      continue
    }
    const segment = `.pipe[${i + 1}]`
    if (rawItem.kind !== "transformation") {
      continue
    }
    if (rawItem.type === "brand") {
      if (typeof rawItem.name !== "string") {
        acc = markOpaque(segment, "a non-string brand name", ctx)
        continue
      }
      acc = `${parenthesizeIfCompound(acc)} & { readonly "~brand": ${JSON.stringify(rawItem.name)} }`
      continue
    }
    acc = markOpaque(segment, "a transform", ctx)
  }
  return acc
}

function markOpaque(segment: string, what: string, ctx: WalkContext): string {
  ctx.path.push(segment)
  const path = currentPath(ctx)
  ctx.path.pop()
  ctx.opaquePaths.push(path)
  ctx.warnings.push(
    `tskm: ${ctx.rootName}: ${what} inside a recursive schema cannot be typed structurally at ${path}; emitted 'unknown'.`,
  )
  return "unknown"
}

function renderLiteral(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value)
}

const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function renderKey(key: string): string {
  return IDENTIFIER_KEY.test(key) ? key : JSON.stringify(key)
}

/**
 * Wraps a rendered type in parentheses when it carries a top-level `|` or `&`, so
 * suffix/intersection positions (`T[]`, `T & B`) bind correctly. Purely syntactic,
 * brace/quote-aware — mirrors how `reindentType` treats literals as opaque.
 */
function parenthesizeIfCompound(rendered: string): string {
  let depth = 0
  let i = 0
  while (i < rendered.length) {
    const ch = rendered[i]
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch
      i++
      while (i < rendered.length) {
        if (rendered[i] === "\\") {
          i += 2
          continue
        }
        if (rendered[i] === quote) {
          break
        }
        i++
      }
    } else if (ch === "{" || ch === "[" || ch === "(" || ch === "<") {
      depth++
    } else if (ch === "}" || ch === "]" || ch === ")" || ch === ">") {
      depth--
    } else if (depth === 0 && (ch === "|" || ch === "&")) {
      return `(${rendered})`
    }
    i++
  }
  return rendered
}

/**
 * The root body's own data-property keys, read directly off the runtime object
 * (unwrapping memoized getters and pipe bases). This is the STRUCTURAL side of the
 * brand-absorption cross-check: if the checker's rendered output for this root has
 * no data properties where the structure clearly has some, an intersection absorbed
 * the body and the splice must be rejected.
 */
function rootDataKeys(schema: unknown): ReadonlyArray<string> {
  let node: unknown = schema
  for (let hops = 0; hops < 16 && isObject(node); hops++) {
    if (Array.isArray(node.pipe)) {
      node = node.pipe[0]
      continue
    }
    if ((node.type === "lazy" || node.type === "recursive") && typeof node.getter === "function") {
      node = (node.getter as () => unknown)()
      continue
    }
    break
  }
  if (isObject(node) && node.type === "object" && isObject(node.entries)) {
    return Object.keys(node.entries)
  }
  return []
}
