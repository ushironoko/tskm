import { existsSync, globSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import {
  type JsonSchemaApproximation,
  loadConfig,
  parseApproximations,
  type ResolvedTskmConfig,
  resolveConfig,
  type TskmConfig,
  type TskmJsonSchemaOptions,
  vendorAllowList,
} from "./config.ts"
import { type CycleGuardState, createCycleGuard, walkWithCycleGuard } from "./cycle-guard.ts"
import { resolveWorker, runWorker, type SchemaWorkerEnvelope } from "./worker-harness.ts"

/**
 * Experimental JSON Schema output.
 *
 * `schemaToJsonSchema` is a pure, duck-typed walker over a runtime tskm schema
 * object (it reads `.type`/`.entries`/`.item`/… — never `instanceof`, so it works
 * across package boundaries). `generateJsonSchema` runs the user's schema module in
 * an isolated subprocess (dynamic import can boot DBs/network), extracts the
 * exported schema objects, walks them, and writes `*.schema.json`.
 *
 * Refinements that JSON Schema can express (min/max length, min/max value, integer,
 * multipleOf, email/url format, regex pattern, description metadata) are mapped, and
 * `lazy`/`recursive` become `$ref`/`$defs`. A type JSON Schema cannot express (`bigint`,
 * `date`, `undefined`, a `check` predicate, a `transform` output, NaN or an infinity) is
 * an error and its file is not written. Each can be approximated only when it is listed
 * in `jsonSchema.approximate`. The error set matches `@tskm/core`'s `withJsonSchema`.
 *
 * A source that produces no document in a run loses its previous output file, so no
 * consumer reads a document that no longer matches its source (see `generateJsonSchema`).
 */

export type JsonSchema = { [key: string]: unknown }

export interface SchemaToJsonResult {
  /** The emitted schema. Only meaningful when `errors` is empty. */
  readonly schema: JsonSchema
  /** Approximations applied under `approximate`. Informational: the schema is still emitted. */
  readonly warnings: ReadonlyArray<string>
  /**
   * Types that cannot be represented and were not approximated. Non-empty means the
   * schema must not be written. Each message starts with the diagnostic path.
   */
  readonly errors: ReadonlyArray<string>
}

/** A duck-typed view of a runtime tskm schema object. */
type SchemaLike = { readonly type?: unknown; readonly pipe?: unknown; [key: string]: unknown }

/**
 * Mutable walk context threaded through the recursion. `path` holds the segments from
 * the root to the node being walked (`.createdAt`, `[0]`), so every diagnostic can name
 * where in the schema it arose.
 */
interface WalkContext {
  readonly io: "input" | "output"
  readonly rootName: string
  readonly approximate: ReadonlySet<JsonSchemaApproximation>
  readonly path: string[]
  readonly warnings: string[]
  readonly errors: string[]
  readonly defs: Record<string, JsonSchema>
  readonly guard: CycleGuardState
  /** Schema object identity -> export-derived def name (for `recursive()` roots). */
  readonly exportNames?: ReadonlyMap<object, string> | undefined
}

/**
 * How each approximation reads in a warning and in the error that offers it. `nonfinite`
 * has three positions (a literal, a picklist option, a numeric keyword), so its caller
 * passes the effect for the position.
 */
const APPROXIMATION_EFFECT: Record<JsonSchemaApproximation, string> = {
  bigint: "as a string",
  date: "as a date-time string",
  undefined: "as an unconstrained schema",
  check: "without the predicate",
  transform: "as the schema before the transform",
  nonfinite: "as a schema no JSON value matches",
}

function isObject(value: unknown): value is SchemaLike {
  return value !== null && typeof value === "object"
}

/** NaN and the infinities: numbers JSON cannot carry (`JSON.stringify` writes them as `null`). */
function isNonFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isFinite(value)
}

/** The JSON values a literal or a picklist option may hold: string, boolean, null, finite number. */
function isJsonScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
}

/** A value's type for a diagnostic: `bigint`, `undefined`, `Date`, and so on. */
function valueKind(value: unknown): string {
  if (value === null) {
    return "null"
  }
  if (typeof value === "object") {
    return Object.prototype.toString.call(value).slice("[object ".length, -1)
  }
  return typeof value
}

export interface SchemaToJsonOptions {
  /**
   * Identity map from exported schema objects to their export-derived names. A
   * hoisted cycle target found in this map is named after its export (`Category`)
   * instead of its schema kind (`object_2`). Acyclic schemas never hoist, so
   * non-recursive output is unaffected.
   */
  readonly exportNames?: ReadonlyMap<object, string>
  /** The export name that starts every diagnostic path (`User` in `User.createdAt`). */
  readonly rootName?: string
  /** Which side of the schema to describe, as `jsonSchema.io` (default `output`). */
  readonly io?: "input" | "output"
  /** Types to approximate instead of failing (see `JSON_SCHEMA_APPROXIMATIONS`). */
  readonly approximate?: ReadonlyArray<JsonSchemaApproximation>
}

/** Pure walker: a runtime tskm schema object -> JSON Schema (draft 2020-12). */
export function schemaToJsonSchema(
  schema: unknown,
  options: SchemaToJsonOptions = {},
): SchemaToJsonResult {
  const ctx: WalkContext = {
    io: options.io ?? "output",
    rootName: options.rootName ?? "schema",
    approximate: new Set(options.approximate ?? []),
    path: [],
    warnings: [],
    errors: [],
    defs: {},
    guard: createCycleGuard(),
    exportNames: options.exportNames,
  }
  const out = walk(schema, ctx)
  if (Object.keys(ctx.defs).length > 0) {
    out.$defs = ctx.defs
  }
  return { schema: out, warnings: ctx.warnings, errors: ctx.errors }
}

/** The diagnostic path of the node being walked: the root name plus the path segments. */
function here(ctx: WalkContext): string {
  return `${ctx.rootName}${ctx.path.join("")}`
}

/** Runs `walkChild` one path segment deeper (object property, array item, tuple slot, ...). */
function atPath<T>(ctx: WalkContext, segment: string, walkChild: () => T): T {
  ctx.path.push(segment)
  try {
    return walkChild()
  } finally {
    ctx.path.pop()
  }
}

/** `.name` for an identifier key, `["name"]` otherwise. */
function propertySegment(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`
}

/** Records a node JSON Schema cannot express, with its path. The walk continues. */
function reportError(ctx: WalkContext, detail: string): void {
  ctx.errors.push(`${here(ctx)}: ${detail}.`)
}

/** A structurally malformed schema node. Reported as an error; the placeholder is `{}`. */
function malformed(ctx: WalkContext, type: string, reason: string): JsonSchema {
  reportError(ctx, `cannot convert schema type "${type}" to JSON Schema: ${reason}`)
  return {}
}

/** Per-use wording for an approximation (see `APPROXIMATION_EFFECT` for the default). */
interface ApproximationNote {
  /** How the stand-in reads, as in "approximated nonfinite by dropping the option NaN". */
  readonly effect?: string
  /** Extra guidance appended to the error that offers the approximation. */
  readonly hint?: string
}

/**
 * Handles a node JSON Schema cannot express. When the caller listed `name` in
 * `approximate`, the approximation is applied and noted as a warning; otherwise an
 * error is recorded that names the option which would accept it. Returns whether the
 * approximation applies.
 */
function approximates(
  ctx: WalkContext,
  name: JsonSchemaApproximation,
  detail: string,
  note: ApproximationNote = {},
): boolean {
  const effect = note.effect ?? APPROXIMATION_EFFECT[name]
  if (ctx.approximate.has(name)) {
    ctx.warnings.push(`${here(ctx)}: approximated ${name} ${effect}.`)
    return true
  }
  ctx.errors.push(
    `${here(ctx)}: ${detail}. Add "${name}" to jsonSchema.approximate (CLI: --approximate ${name}) to emit it ${effect} instead.${note.hint ?? ""}`,
  )
  return false
}

/**
 * Walks one schema through the shared cycle guard, terminating any containment cycle
 * (lazy, recursive, or hand-built) by hoisting a re-encountered object into `$defs`
 * and emitting a `$ref` to it (see `cycle-guard.ts`).
 */
function walk(schema: unknown, ctx: WalkContext): JsonSchema {
  if (!isObject(schema)) {
    reportError(ctx, `cannot convert non-object schema (${String(schema)}) to JSON Schema`)
    return {}
  }

  return walkWithCycleGuard<JsonSchema>(schema, ctx.guard, {
    emitRef: (name) => ({ $ref: `#/$defs/${name}` }),
    storeDef: (name, body) => {
      ctx.defs[name] = body
    },
    hasDef: (name) => name in ctx.defs,
    baseName: (target) => {
      const fromExport = ctx.exportNames?.get(target)
      if (fromExport !== undefined) {
        return fromExport
      }
      const type = (target as SchemaLike).type
      return typeof type === "string" ? type : "schema"
    },
    // A piped schema carries the base plus a `pipe: [base, ...items]`. Walk the base
    // and fold each item's constraints onto it.
    walkBody: (target) => {
      const t = target as SchemaLike
      return Array.isArray(t.pipe)
        ? walkPipe(t as SchemaLike & { pipe: unknown[] }, ctx)
        : walkSchema(t, ctx)
    },
  })
}

/**
 * `literal(value)`. A non-finite number has no JSON value: `JSON.stringify` writes it as
 * `null`, which would accept `null` instead. Approximated as a schema no JSON value matches,
 * which is what `never` emits.
 */
function literalSchema(value: unknown, ctx: WalkContext): JsonSchema {
  if (isJsonScalar(value)) {
    return { const: value }
  }
  if (isNonFiniteNumber(value)) {
    const detail = `cannot convert schema type "literal" to JSON Schema: ${String(value)} has no JSON representation`
    return approximates(ctx, "nonfinite", detail) ? { not: {} } : {}
  }
  return malformed(ctx, "literal", `a ${valueKind(value)} value has no JSON representation`)
}

/**
 * `picklist(options)`. A non-finite option is dropped from the `enum` when `nonfinite` is
 * listed, since no JSON value equals it. Any other non-JSON option is an error.
 */
function picklistSchema(options: unknown, ctx: WalkContext): JsonSchema {
  if (!Array.isArray(options)) {
    return malformed(ctx, "picklist", "options is not an array")
  }
  const members: unknown[] = []
  for (const option of options) {
    if (isJsonScalar(option)) {
      members.push(option)
    } else if (isNonFiniteNumber(option)) {
      const text = String(option)
      approximates(
        ctx,
        "nonfinite",
        `cannot convert schema type "picklist" to JSON Schema: option ${text} has no JSON representation`,
        { effect: `by dropping the option ${text}` },
      )
    } else {
      reportError(
        ctx,
        `cannot convert schema type "picklist" to JSON Schema: a ${valueKind(option)} option has no JSON representation`,
      )
    }
  }
  return { enum: members }
}

/**
 * A pipe requirement that becomes a numeric keyword (`minimum`, `multipleOf`, `minLength`,
 * ...). It must be a finite JS number. A non-finite number is approximated by omitting the
 * keyword, and returns `undefined`. Any other value (a bigint, a Date, a string) has no
 * keyword form, so it is always an error. `keyword` names the keyword(s) in the messages.
 */
function numericRequirement(
  ctx: WalkContext,
  item: SchemaLike,
  requirement: unknown,
  keyword: string,
): number | undefined {
  if (typeof requirement === "number" && Number.isFinite(requirement)) {
    return requirement
  }
  const type = String(item.type)
  if (isNonFiniteNumber(requirement)) {
    approximates(
      ctx,
      "nonfinite",
      `cannot convert pipe item "${type}" to JSON Schema: ${String(requirement)} has no JSON representation`,
      { effect: `by omitting ${keyword}` },
    )
    return undefined
  }
  reportError(
    ctx,
    `cannot convert pipe item "${type}" to JSON Schema: its requirement is of type ${valueKind(requirement)}, not a finite number, so it has no ${keyword} keyword`,
  )
  return undefined
}

function walkSchema(schema: SchemaLike, ctx: WalkContext): JsonSchema {
  const type = schema.type
  switch (type) {
    case "string":
      return { type: "string" }
    case "number":
      return { type: "number" }
    case "boolean":
      return { type: "boolean" }
    case "null":
      return { type: "null" }
    case "bigint":
      return approximates(
        ctx,
        "bigint",
        'cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation',
      )
        ? { type: "string" }
        : {}
    case "date":
      return approximates(
        ctx,
        "date",
        'cannot convert schema type "date" to JSON Schema: Date has no JSON representation',
      )
        ? { type: "string", format: "date-time" }
        : {}
    case "undefined":
      approximates(
        ctx,
        "undefined",
        'cannot convert schema type "undefined" to JSON Schema: undefined has no JSON representation',
      )
      return {}
    case "any":
    case "unknown":
      return {}
    case "never":
      return { not: {} }
    case "literal":
      return literalSchema(schema.literal, ctx)
    case "picklist":
      return picklistSchema(schema.options, ctx)
    case "object":
      return walkObject(schema, ctx)
    case "array": {
      if (!isObject(schema.item)) {
        return malformed(ctx, "array", "item is not a schema")
      }
      return { type: "array", items: atPath(ctx, "[]", () => walk(schema.item, ctx)) }
    }
    case "record": {
      // A keyed record (issue #19) constrains keys via `propertyNames`; an unkeyed record
      // keeps the open `additionalProperties` form.
      if (!isObject(schema.value)) {
        return malformed(ctx, "record", "value is not a schema")
      }
      const recordValue = atPath(ctx, "[]", () => walk(schema.value, ctx))
      if (isObject(schema.key)) {
        const propertyNames = atPath(ctx, "[key]", () => walk(schema.key, ctx))
        return { type: "object", additionalProperties: recordValue, propertyNames }
      }
      return { type: "object", additionalProperties: recordValue }
    }
    case "tuple": {
      const items = schema.items
      if (!Array.isArray(items)) {
        return malformed(ctx, "tuple", "items is not an array")
      }
      return {
        type: "array",
        prefixItems: items.map((item, index) => atPath(ctx, `[${index}]`, () => walk(item, ctx))),
        items: false,
      }
    }
    case "union": {
      const options = schema.options
      if (!Array.isArray(options)) {
        return malformed(ctx, "union", "options is not an array")
      }
      return {
        anyOf: options.map((option, index) => atPath(ctx, `[${index}]`, () => walk(option, ctx))),
      }
    }
    case "discriminated_union": {
      // `oneOf` (members are mutually exclusive by tag) + the discriminant `const`, which
      // each member's object walker already emits for its `literal` discriminant entry. The
      // discriminant key is surfaced as a vendor extension (primitive contract, section 2).
      const options = schema.options
      if (!Array.isArray(options)) {
        return malformed(ctx, "discriminated_union", "options is not an array")
      }
      const result: JsonSchema = {
        oneOf: options.map((option, index) => atPath(ctx, `[${index}]`, () => walk(option, ctx))),
      }
      if (typeof schema.discriminant === "string") {
        result["x-tskm-discriminant"] = schema.discriminant
      }
      return result
    }
    case "templateLiteral": {
      // Pattern approximation (the anchored runtime regex) plus a vendor extension that
      // carries the literal structure for richer consumers.
      const ext = typeof schema.expects === "string" ? schema.expects : true
      return typeof schema.pattern === "string"
        ? { type: "string", pattern: schema.pattern, "x-tskm-template": ext }
        : { type: "string", "x-tskm-template": ext }
    }
    case "optional":
      // The object walker drops the key from `required`; the value type is the wrapped one.
      return walk(schema.wrapped, ctx)
    case "preprocess":
      // The output is the inner schema. The input is `unknown`: any value is accepted
      // before the operation runs, so the input side is `{}` (as `withJsonSchema` emits).
      if (ctx.io === "input") {
        return {}
      }
      return walk(schema.wrapped, ctx)
    case "fallback":
      // A fallback only recovers a failed parse with its value, so both sides keep the
      // inner type. The fallback value is not emitted as a `default` keyword.
      return walk(schema.wrapped, ctx)
    case "nullable":
      return { anyOf: [walk(schema.wrapped, ctx), { type: "null" }] }
    case "nullish":
      // `T | null | undefined`. Inside an object the undefined case is the absent key
      // (the object walker drops it from `required`). Elsewhere JSON has no undefined,
      // so only null is added.
      return { anyOf: [walk(schema.wrapped, ctx), { type: "null" }] }
    case "lazy":
    case "recursive":
      return walkDeferred(schema, ctx)
    default:
      reportError(
        ctx,
        `cannot convert schema type "${String(type)}" to JSON Schema: this schema kind has no JSON Schema representation`,
      )
      return {}
  }
}

function walkObject(schema: SchemaLike, ctx: WalkContext): JsonSchema {
  const entries = schema.entries
  if (!isObject(entries)) {
    return malformed(ctx, "object", "entries is not an object")
  }
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const key of Object.keys(entries)) {
    const entry = entries[key]
    properties[key] = atPath(ctx, propertySegment(key), () => walk(entry, ctx))
    // A key is optional iff its entry's own kind is `optional`/`nullish`.
    const entryType = isObject(entry) ? entry.type : undefined
    if (entryType !== "optional" && entryType !== "nullish") {
      required.push(key)
    }
  }
  return {
    type: "object",
    properties,
    required,
    // The unknown-key policy: `passthrough` keeps undeclared keys (open object), every
    // other mode (`strip`/`exact`/absent) is closed. (Issue #16.)
    additionalProperties: schema.rest === "passthrough",
  }
}

/**
 * `lazy` and `recursive` both defer their body behind a memoized `getter`. The cycle
 * guard lives in `walk` and keys on object identity — for `recursive` the schema
 * object itself IS the `self` placeholder the builder received — so any back-edge
 * through the getter terminates via a hoisted `$ref` rather than recursing forever.
 */
function walkDeferred(schema: SchemaLike, ctx: WalkContext): JsonSchema {
  const getter = schema.getter
  if (typeof getter !== "function") {
    return malformed(ctx, String(schema.type), "it has no getter")
  }
  const inner = (getter as () => unknown)()
  return walk(inner, ctx)
}

/** `transform` items split an input-side pipe: what follows describes the output. */
function isTransformItem(item: SchemaLike): boolean {
  return item.kind === "transformation" && item.type === "transform"
}

function walkPipe(schema: SchemaLike & { pipe: unknown[] }, ctx: WalkContext): JsonSchema {
  const [base, ...items] = schema.pipe
  if (!isObject(base)) {
    reportError(ctx, "cannot convert a pipe whose base is not a schema object")
    return {}
  }
  // The input of a preprocess is `unknown`, so constraints on it (which check the
  // output) have no input-side meaning.
  if (ctx.io === "input" && base.type === "preprocess") {
    return {}
  }

  const transformAt = items.findIndex((item) => isObject(item) && isTransformItem(item))
  const out = walk(base, ctx)
  const lengthKeyword = base.type === "array" ? "Items" : "Length"
  for (let index = 0; index < items.length; index++) {
    const rawItem = items[index]
    if (!isObject(rawItem)) {
      reportError(ctx, "cannot convert a non-object pipe item to JSON Schema")
      continue
    }
    if (ctx.io === "input" && transformAt !== -1 && index >= transformAt) {
      // After a transform only the description still describes the input.
      if (rawItem.type === "description" && typeof rawItem.requirement === "string") {
        out.description = rawItem.requirement
      }
      continue
    }
    applyItem(rawItem, out, lengthKeyword, ctx)
  }
  return out
}

/** Sets a numeric keyword unless its requirement was omitted (see `numericRequirement`). */
function assignNumber(out: JsonSchema, key: string, value: number | undefined): void {
  if (value !== undefined) {
    out[key] = value
  }
}

/** Folds one pipe item's constraint onto the (mutable) accumulated JSON Schema. */
function applyItem(
  item: SchemaLike,
  out: JsonSchema,
  lengthKeyword: "Items" | "Length",
  ctx: WalkContext,
): void {
  const type = item.type
  const requirement = item.requirement
  const minKey = `min${lengthKeyword}`
  const maxKey = `max${lengthKeyword}`
  switch (type) {
    case "min_length":
      assignNumber(out, minKey, numericRequirement(ctx, item, requirement, minKey))
      return
    case "max_length":
      assignNumber(out, maxKey, numericRequirement(ctx, item, requirement, maxKey))
      return
    case "length": {
      const value = numericRequirement(ctx, item, requirement, `${minKey} and ${maxKey}`)
      assignNumber(out, minKey, value)
      assignNumber(out, maxKey, value)
      return
    }
    case "non_empty":
      out[minKey] = 1
      return
    case "min_value":
      assignNumber(out, "minimum", numericRequirement(ctx, item, requirement, "minimum"))
      return
    case "max_value":
      assignNumber(out, "maximum", numericRequirement(ctx, item, requirement, "maximum"))
      return
    case "integer":
      out.type = "integer"
      return
    case "multiple_of":
      assignNumber(out, "multipleOf", numericRequirement(ctx, item, requirement, "multipleOf"))
      return
    case "email":
      out.format = "email"
      return
    case "url":
      out.format = "uri"
      return
    case "regex":
      if (isObject(requirement) && typeof requirement.source === "string") {
        out.pattern = requirement.source
        return
      }
      reportError(
        ctx,
        'cannot convert pipe item "regex" to JSON Schema: requirement is not a RegExp',
      )
      return
    case "description":
      if (typeof requirement === "string") {
        out.description = requirement
      }
      return
    case "brand":
    case "readonly":
      // Neither changes the JSON value, so both are dropped without a note (as in core).
      return
    case "check":
      // Approximated: the predicate is dropped and the base schema stands.
      approximates(
        ctx,
        "check",
        'cannot convert pipe item "check" to JSON Schema: a function predicate has no JSON Schema representation',
      )
      return
    case "transform":
      // Approximated: the base schema stands for the output. Constraints chained after the
      // transform are still applied to it, as before this option existed.
      approximates(
        ctx,
        "transform",
        'cannot convert pipe item "transform" to JSON Schema output: the transform\'s output type is not reified at runtime',
        { hint: ' Or set jsonSchema.io to "input", which needs no approximation.' },
      )
      return
    default:
      reportError(
        ctx,
        `cannot convert pipe item "${String(type)}" to JSON Schema: it has no JSON Schema representation`,
      )
  }
}

export interface JsonSchemaOptions {
  readonly root?: string
  readonly config?: TskmConfig
  /** Hard timeout (ms) for each isolated worker import. */
  readonly timeoutMs?: number
  /**
   * Runtime used to execute the isolated worker (defaults to `process.execPath`).
   * Set this when the schema modules are TypeScript and the host runtime cannot import
   * `.ts` (e.g. point it at a `bun`/`tsx` binary).
   */
  readonly execPath?: string
  /**
   * Overrides the `jsonSchema` options of the resolved config, field by field: a field
   * left undefined keeps the config's value. The CLI passes its flags here, so the rest
   * of `tskm.config.*` still applies.
   */
  readonly jsonSchema?: TskmJsonSchemaOptions
}

export interface JsonSchemaFile {
  readonly source: string
  readonly output: string
  readonly schemaNames: ReadonlyArray<string>
}

export interface JsonSchemaResult {
  readonly files: ReadonlyArray<JsonSchemaFile>
  /** Every diagnostic line in source order: approximation notes, warnings, and errors. */
  readonly diagnostics: ReadonlyArray<string>
  /**
   * The error lines: types that cannot be represented and were not approximated, and
   * Standard Schema conversions that failed. A source with any error is not written.
   * Non-empty means the run failed.
   */
  readonly errors: ReadonlyArray<string>
  /**
   * Output files this run deleted, because their source is a schema module that produced
   * no document (its schemas failed, or none were emitted). Each path is the file tskm
   * would have written for that source.
   */
  readonly removed: ReadonlyArray<string>
}

export function jsonSchemaOutputPath(sourceFileAbs: string, config: ResolvedTskmConfig): string {
  const outDir = config.jsonSchema.outDir
  if (outDir) {
    return join(config.root, outDir, basename(sourceFileAbs).replace(/\.ts$/, ".json"))
  }
  return sourceFileAbs.replace(/\.ts$/, ".json")
}

/** True for paths the JSON Schema pass itself produces or that sidecars/queries own. */
function isExcludedSource(absPath: string): boolean {
  return (
    absPath.endsWith(".gen.ts") ||
    absPath.endsWith(".tskm-query.ts") ||
    absPath.endsWith(".schema.json")
  )
}

function collectSources(config: ResolvedTskmConfig): string[] {
  const matches = new Set<string>()
  for (const pattern of config.include) {
    for (const match of globSync(pattern, { cwd: config.root })) {
      const abs = isAbsolute(match) ? match : resolve(config.root, match)
      if (isExcludedSource(abs)) {
        continue
      }
      matches.add(abs)
    }
  }
  return [...matches].sort()
}

/**
 * The per-export envelope entry — the single declaration both ends of the
 * worker protocol import (the structural worker's pattern). An entry with `errors`
 * makes its whole source file unwritten. A `skipped` entry (an export whose vendor is
 * outside the allow-list, see `excludedVendor`) is left out of the document, and its
 * diagnostic is aggregated per vendor.
 */
export interface JsonWorkerEntry {
  readonly name: string
  readonly schema: JsonSchema
  readonly warnings: ReadonlyArray<string>
  /** Messages for types that cannot be represented (see `JsonSchemaResult.errors`). */
  readonly errors?: ReadonlyArray<string>
  readonly skipped?: boolean
  /** Set when the export's vendor is outside the allow-list (always skipped). */
  readonly excludedVendor?: string
  /** Present when the worker was asked for static Standard JSON Schema documents. */
  readonly staticDocs?: StaticJsonSchemaDocs
  readonly staticErrors?: ReadonlyArray<string>
  readonly staticWarnings?: ReadonlyArray<string>
}

/** The worker's argv[4] protocol: adapter routing context (see jsonschema-adapter.ts). */
export interface JsonWorkerContext {
  readonly io: "input" | "output"
  readonly allowedVendors: ReadonlyArray<string>
  /** Types the tskm walker may approximate instead of failing (`jsonSchema.approximate`). */
  readonly approximate: ReadonlyArray<JsonSchemaApproximation>
  /**
   * When true, each tskm export also carries precomputed documents for every target
   * and both sides (`staticDocs`). The `.json` file path leaves this unset.
   */
  readonly staticEmit?: boolean
}

/** Applies the caller's `jsonSchema` overrides field by field (see `JsonSchemaOptions`). */
function withJsonSchemaOverrides(
  base: ResolvedTskmConfig,
  overrides: TskmJsonSchemaOptions | undefined,
): ResolvedTskmConfig {
  if (overrides === undefined) {
    return base
  }
  return {
    ...base,
    jsonSchema: {
      outDir: overrides.outDir ?? base.jsonSchema.outDir,
      io: overrides.io ?? base.jsonSchema.io,
      approximate:
        overrides.approximate === undefined
          ? base.jsonSchema.approximate
          : parseApproximations(overrides.approximate, "jsonSchema.approximate"),
      emit: overrides.emit ?? base.jsonSchema.emit,
    },
  }
}

export async function generateJsonSchema(
  options: JsonSchemaOptions = {},
): Promise<JsonSchemaResult> {
  const root = resolve(options.root ?? process.cwd())
  const base = options.config ? resolveConfig(options.config, root) : await loadConfig(root)
  const config = withJsonSchemaOverrides(base, options.jsonSchema)
  const workerAbs = resolveWorker("jsonschema-worker")
  const timeoutMs = options.timeoutMs ?? 5000
  const execPath = options.execPath ?? process.execPath
  const workerContext: JsonWorkerContext = {
    io: config.jsonSchema.io,
    allowedVendors: vendorAllowList(config.schemaSources),
    approximate: config.jsonSchema.approximate,
  }

  const sources = collectSources(config)
  const files: JsonSchemaFile[] = []
  const diagnostics: string[] = []
  const errors: string[] = []
  const removed: string[] = []
  // Outputs this run has written. An `outDir` can flatten two sources to one output path, and
  // a failing source must not delete a file that another source just wrote.
  const written = new Set<string>()

  for (const sourceAbs of sources) {
    const output = jsonSchemaOutputPath(sourceAbs, config)
    // Each source imports the user's module in an isolated, SIGKILL-guarded child;
    // per-file serialization is acceptable for this experimental path.
    const result = runWorker<SchemaWorkerEnvelope<JsonWorkerEntry>>(workerAbs, sourceAbs, {
      root,
      execPath,
      timeoutMs,
      tag: "jsonschema",
      extraArgs: [JSON.stringify(workerContext)],
    })
    if (result.diagnostic !== undefined) {
      diagnostics.push(result.diagnostic)
      // The module did not load, so nothing is known about its schemas. The previous output is
      // kept (tskm cannot show that it wrote that file), and the run's exit code does not change.
      // The warning says so instead.
      if (!written.has(output) && existsSync(output)) {
        diagnostics.push(
          `tskm: ${output}: may be out of date: ${sourceAbs} could not be loaded, so its previous output was kept.`,
        )
      }
      continue
    }

    const schemas = result.envelope.schemas ?? []
    const excludedCounts = new Map<string, number>()
    const sourceErrors: string[] = []
    for (const entry of schemas) {
      if (entry.excludedVendor !== undefined) {
        excludedCounts.set(
          entry.excludedVendor,
          (excludedCounts.get(entry.excludedVendor) ?? 0) + 1,
        )
      }
      for (const warning of entry.warnings) {
        diagnostics.push(`tskm: ${sourceAbs}: ${warning}`)
      }
      for (const error of entry.errors ?? []) {
        sourceErrors.push(`tskm: ${sourceAbs}: ${error}`)
      }
    }
    // One line per (file, vendor), not per export: enough to surface both a
    // deliberate opt-out and the vendor-string/package-root mismatch trap
    // (a configured source whose runtime `~standard.vendor` differs from its
    // package root lands here too), without per-schema noise.
    for (const [vendor, count] of excludedCounts) {
      diagnostics.push(
        `tskm: ${sourceAbs}: ${count} Standard Schema export(s) with vendor "${vendor}" not converted: the vendor is not in the allow-list derived from schemaSources ([${workerContext.allowedVendors.join(", ")}]). Add the vendor's package to schemaSources to enable it — its "~standard" vendor string must match the package root.`,
      )
    }
    diagnostics.push(...sourceErrors)
    errors.push(...sourceErrors)
    const emittable = schemas.filter((entry) => !entry.skipped)
    // Fail closed: a file with any schema that cannot be represented is not written at all, so
    // no consumer reads a document that silently lacks or approximates a type. The same holds
    // when no export is emitted at all. The previous output then no longer matches its source,
    // so it is removed. A file with no schema exports is not a schema module: it is never touched.
    if (sourceErrors.length > 0 || emittable.length === 0) {
      if (schemas.length > 0) {
        removeStaleOutput(output, written, removed, errors)
      }
      continue
    }

    const document: Record<string, JsonSchema> = {}
    for (const entry of emittable) {
      document[entry.name] = entry.schema
    }
    try {
      // `outDir` may not exist yet; a failed write is reported, not thrown, so the other sources still run.
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`)
    } catch (error) {
      errors.push(`tskm: ${output}: could not write the JSON Schema: ${String(error)}.`)
      // The previous document no longer matches its source either.
      removeStaleOutput(output, written, removed, errors)
      continue
    }
    written.add(output)
    files.push({ source: sourceAbs, output, schemaNames: emittable.map((s) => s.name) })
  }

  return { files, diagnostics, errors, removed }
}

/**
 * Deletes the previous output of a schema module that produced no document this run. Only a
 * regular file is removed. A failed delete is an error, so the run fails instead of leaving
 * the stale file without notice.
 */
function removeStaleOutput(
  output: string,
  written: ReadonlySet<string>,
  removed: string[],
  errors: string[],
): void {
  if (written.has(output) || statSync(output, { throwIfNoEntry: false })?.isFile() !== true) {
    return
  }
  try {
    rmSync(output)
    removed.push(output)
  } catch (error) {
    errors.push(`tskm: ${output}: could not delete the previous output: ${String(error)}.`)
  }
}

/** One side of a precomputed Standard JSON Schema document. */
export interface StaticJsonSchemaSide {
  readonly input?: JsonSchema
  readonly output?: JsonSchema
}

/**
 * Documents keyed by target, then by side. The same shape `withStaticJsonSchema` reads.
 * A missing side is a call that throws.
 */
export interface StaticJsonSchemaDocs {
  readonly "draft-2020-12"?: StaticJsonSchemaSide
  readonly "draft-07"?: StaticJsonSchemaSide
  readonly "openapi-3.0"?: StaticJsonSchemaSide
}

const STATIC_TARGETS = ["draft-2020-12", "draft-07", "openapi-3.0"] as const
type StaticTarget = (typeof STATIC_TARGETS)[number]
const STATIC_IOS = ["input", "output"] as const

export interface StaticJsonSchemaConverters {
  /** The runtime walker (`convertToJsonSchema`). Success here is copied verbatim. */
  readonly convert: (
    schema: unknown,
    io: "input" | "output",
    options: { readonly target: StaticTarget },
  ) => Record<string, unknown>
  /** Rewrites an approximated draft-2020-12 document. Not used when `convert` succeeds. */
  readonly retarget: (
    document: JsonSchema,
    target: "draft-07" | "openapi-3.0",
  ) => Record<string, unknown>
}

export interface StaticJsonSchemaBuildOptions {
  readonly approximate?: ReadonlyArray<JsonSchemaApproximation>
  /** Export name that starts diagnostic paths (`User` in `User.createdAt`). */
  readonly rootName?: string
  /** Passed to the compiler walker only when an approximation stands in for a throw. */
  readonly exportNames?: ReadonlyMap<object, string>
  readonly converters: StaticJsonSchemaConverters
}

export interface StaticJsonSchemaBuild {
  readonly docs: StaticJsonSchemaDocs
  /**
   * The export produced no document. Callers must not emit a const. Each line is a
   * path-prefixed diagnostic without the `tskm:` source prefix.
   */
  readonly errors: ReadonlyArray<string>
  /**
   * Approximations that were applied, and targets that were omitted while other
   * cells were emitted. The emitted cells are still safe to write.
   */
  readonly warnings: ReadonlyArray<string>
}

interface CellFailure {
  readonly target: StaticTarget
  readonly message: string
}

function thrownMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith("tskm: ") ? message.slice("tskm: ".length) : message
}

function groupFailures(
  root: string,
  io: "input" | "output",
  failures: ReadonlyArray<CellFailure>,
): string[] {
  const groups = new Map<string, StaticTarget[]>()
  for (const failure of failures) {
    const targets = groups.get(failure.message) ?? []
    targets.push(failure.target)
    groups.set(failure.message, targets)
  }
  const lines: string[] = []
  for (const [message, targets] of groups) {
    lines.push(`${root}: ${io} (${targets.join(", ")}): ${message}`)
  }
  return lines
}

type MutableDocs = {
  -readonly [Key in keyof StaticJsonSchemaDocs]?: { input?: JsonSchema; output?: JsonSchema }
}

function writeCell(
  docs: MutableDocs,
  target: StaticTarget,
  io: "input" | "output",
  schema: JsonSchema,
): void {
  const side = docs[target] ?? {}
  side[io] = schema
  docs[target] = side
}

function hasCell(docs: StaticJsonSchemaDocs): boolean {
  for (const target of STATIC_TARGETS) {
    const side = docs[target]
    if (side?.input !== undefined || side?.output !== undefined) {
      return true
    }
  }
  return false
}

/**
 * Builds the static documents for one runtime schema.
 *
 * Where `convert` succeeds, the cell is that return value, so it matches
 * `withJsonSchema` for that target and side (including `default`, and including
 * draft-07 / OpenAPI rewrites). Where `convert` throws and `approximate` makes the
 * compiler walker succeed, the cell is that walker's draft-2020-12 document
 * retargeted the same way. A throw that approximation does not cover is omitted,
 * never replaced with a quieter document. `convert` itself is never taught to
 * approximate.
 */
export function buildStaticJsonSchemaDocs(
  schema: unknown,
  options: StaticJsonSchemaBuildOptions,
): StaticJsonSchemaBuild {
  const root = options.rootName ?? "schema"
  const approximate = options.approximate ?? []
  const docs: MutableDocs = {}
  const errors: string[] = []
  const warnings: string[] = []

  for (const io of STATIC_IOS) {
    const cells = new Map<StaticTarget, JsonSchema>()
    const failures: CellFailure[] = []
    for (const target of STATIC_TARGETS) {
      try {
        cells.set(target, options.converters.convert(schema, io, { target }))
      } catch (error) {
        failures.push({ target, message: thrownMessage(error) })
      }
    }

    const draftFailed = failures.some((failure) => failure.target === "draft-2020-12")
    if (draftFailed) {
      const approx = schemaToJsonSchema(schema, {
        io,
        approximate,
        rootName: root,
        exportNames: options.exportNames,
      })
      // The compiler walker produced a document only by approximating. Use it, and
      // retarget. A success with no warning means the compiler dropped something
      // `withJsonSchema` refuses (a non-JSON default). That stays a failure.
      if (approx.errors.length === 0 && approx.warnings.length > 0) {
        warnings.push(...approx.warnings)
        const replaced = new Map<StaticTarget, JsonSchema>()
        const retargetFailures: CellFailure[] = []
        replaced.set("draft-2020-12", approx.schema)
        for (const target of ["draft-07", "openapi-3.0"] as const) {
          try {
            replaced.set(target, options.converters.retarget(approx.schema, target))
          } catch (error) {
            retargetFailures.push({ target, message: thrownMessage(error) })
          }
        }
        warnings.push(...groupFailures(root, io, retargetFailures))
        cells.clear()
        for (const [target, document] of replaced) {
          cells.set(target, document)
        }
      } else {
        errors.push(...groupFailures(root, io, failures))
        cells.clear()
      }
    } else if (failures.length > 0) {
      // draft-2020-12 matched the runtime walker. Other targets that throw (OpenAPI
      // `propertyNames`) are omitted. Their documents are not invented.
      warnings.push(...groupFailures(root, io, failures))
    }

    if (!draftFailed || cells.has("draft-2020-12")) {
      for (const [target, document] of cells) {
        writeCell(docs, target, io, document)
      }
    }
  }

  if (!hasCell(docs)) {
    return { docs: {}, errors, warnings }
  }
  // Some cells exist, so the omissions are warnings and the export can still be emitted.
  return { docs, errors: [], warnings: [...warnings, ...errors] }
}

export interface StaticJsonSchemaExport {
  readonly name: string
  readonly docs: StaticJsonSchemaDocs
  readonly warnings: ReadonlyArray<string>
  readonly errors: ReadonlyArray<string>
}

export interface StaticJsonSchemaFileResult {
  readonly exports: ReadonlyArray<StaticJsonSchemaExport>
  /** Set when the worker could not load the module. No export was inspected. */
  readonly diagnostic?: string
}

/**
 * Runs the JSON Schema worker for one source and returns the static documents.
 * Does not write a file. Used by sidecar generation when `jsonSchema.emit` is
 * `"standard"`.
 */
export function collectStaticJsonSchemaForFile(
  sourceAbs: string,
  config: ResolvedTskmConfig,
): StaticJsonSchemaFileResult {
  const workerAbs = resolveWorker("jsonschema-worker")
  const workerContext: JsonWorkerContext = {
    io: config.jsonSchema.io,
    allowedVendors: vendorAllowList(config.schemaSources),
    approximate: config.jsonSchema.approximate,
    staticEmit: true,
  }
  const result = runWorker<SchemaWorkerEnvelope<JsonWorkerEntry>>(workerAbs, sourceAbs, {
    root: config.root,
    execPath: config.worker.execPath ?? process.execPath,
    timeoutMs: config.worker.timeoutMs,
    tag: "jsonschema-static",
    extraArgs: [JSON.stringify(workerContext)],
  })
  if (result.diagnostic !== undefined) {
    return { exports: [], diagnostic: result.diagnostic }
  }
  const exports: StaticJsonSchemaExport[] = []
  for (const entry of result.envelope.schemas ?? []) {
    if (entry.staticDocs === undefined && entry.staticErrors === undefined) {
      continue
    }
    exports.push({
      name: entry.name,
      docs: entry.staticDocs ?? {},
      warnings: entry.staticWarnings ?? [],
      errors: entry.staticErrors ?? [],
    })
  }
  return { exports }
}
