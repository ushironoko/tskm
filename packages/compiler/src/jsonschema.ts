import { globSync, writeFileSync } from "node:fs"
import { basename, isAbsolute, join, resolve } from "node:path"
import {
  loadConfig,
  type ResolvedTskmConfig,
  resolveConfig,
  type TskmConfig,
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
 * multipleOf, email/url format, regex pattern) are mapped; `transform`/`brand` and
 * other non-representable actions are dropped with a warning. `lazy` becomes
 * `$ref`/`$defs`.
 */

export type JsonSchema = { [key: string]: unknown }

export interface SchemaToJsonResult {
  readonly schema: JsonSchema
  readonly warnings: ReadonlyArray<string>
}

/** A duck-typed view of a runtime tskm schema object. */
type SchemaLike = { readonly type?: unknown; readonly pipe?: unknown; [key: string]: unknown }

/** Mutable walk context threaded through the recursion (closes over warnings + cycle guard). */
interface WalkContext {
  readonly warnings: string[]
  readonly defs: Record<string, JsonSchema>
  readonly guard: CycleGuardState
  /** Schema object identity -> export-derived def name (for `recursive()` roots). */
  readonly exportNames?: ReadonlyMap<object, string> | undefined
}

function isObject(value: unknown): value is SchemaLike {
  return value !== null && typeof value === "object"
}

export interface SchemaToJsonOptions {
  /**
   * Identity map from exported schema objects to their export-derived names. A
   * hoisted cycle target found in this map is named after its export (`Category`)
   * instead of its schema kind (`object_2`). Acyclic schemas never hoist, so
   * non-recursive output is unaffected.
   */
  readonly exportNames?: ReadonlyMap<object, string>
}

/** Pure walker: a runtime tskm schema object -> JSON Schema (draft 2020-12). */
export function schemaToJsonSchema(
  schema: unknown,
  options: SchemaToJsonOptions = {},
): SchemaToJsonResult {
  const ctx: WalkContext = {
    warnings: [],
    defs: {},
    guard: createCycleGuard(),
    exportNames: options.exportNames,
  }
  const out = walk(schema, ctx)
  if (Object.keys(ctx.defs).length > 0) {
    out.$defs = ctx.defs
  }
  return { schema: out, warnings: ctx.warnings }
}

/**
 * Walks one schema through the shared cycle guard, terminating any containment cycle
 * (lazy, recursive, or hand-built) by hoisting a re-encountered object into `$defs`
 * and emitting a `$ref` to it (see `cycle-guard.ts`).
 */
function walk(schema: unknown, ctx: WalkContext): JsonSchema {
  if (!isObject(schema)) {
    ctx.warnings.push(`tskm: cannot convert non-object schema (${String(schema)}); emitting {}.`)
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
    // and fold each item's constraints onto it; non-representable items warn + skip.
    walkBody: (target) => {
      const t = target as SchemaLike
      return Array.isArray(t.pipe)
        ? walkPipe(t as SchemaLike & { pipe: unknown[] }, ctx)
        : walkSchema(t, ctx)
    },
  })
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
    case "bigint":
      ctx.warnings.push("tskm: bigint has no JSON representation; emitting string.")
      return { type: "string" }
    case "date":
      ctx.warnings.push("tskm: Date is serialized as an ISO date-time string.")
      return { type: "string", format: "date-time" }
    case "null":
      return { type: "null" }
    case "undefined":
      ctx.warnings.push("tskm: undefined has no JSON representation; emitting {}.")
      return {}
    case "any":
    case "unknown":
      return {}
    case "never":
      return { not: {} }
    case "literal":
      return { const: schema.literal }
    case "picklist":
      return { enum: schema.options }
    case "object":
      return walkObject(schema, ctx)
    case "array":
      return { type: "array", items: walk(schema.item, ctx) }
    case "record":
      return { type: "object", additionalProperties: walk(schema.value, ctx) }
    case "tuple": {
      const items = Array.isArray(schema.items) ? schema.items : []
      return {
        type: "array",
        prefixItems: items.map((item) => walk(item, ctx)),
        items: false,
      }
    }
    case "union": {
      const options = Array.isArray(schema.options) ? schema.options : []
      return { anyOf: options.map((option) => walk(option, ctx)) }
    }
    case "optional":
      // The object walker drops the key from `required`; the value type is the wrapped one.
      return walk(schema.wrapped, ctx)
    case "nullable":
      return { anyOf: [walk(schema.wrapped, ctx), { type: "null" }] }
    case "nullish":
      // nullish is `T | null | undefined`; JSON Schema can express null but not undefined.
      ctx.warnings.push("tskm: nullish drops `undefined` in JSON Schema (only null is expressed).")
      return { anyOf: [walk(schema.wrapped, ctx), { type: "null" }] }
    case "lazy":
    case "recursive":
      return walkDeferred(schema, ctx)
    default:
      ctx.warnings.push(`tskm: unknown schema type "${String(type)}"; emitting {}.`)
      return {}
  }
}

function walkObject(schema: SchemaLike, ctx: WalkContext): JsonSchema {
  const entries = isObject(schema.entries) ? schema.entries : {}
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const key of Object.keys(entries)) {
    const entry = entries[key]
    properties[key] = walk(entry, ctx)
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
    additionalProperties: false,
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
    ctx.warnings.push(`tskm: ${String(schema.type)} schema has no getter; emitting {}.`)
    return {}
  }
  const inner = (getter as () => unknown)()
  return walk(inner, ctx)
}

function walkPipe(schema: SchemaLike & { pipe: unknown[] }, ctx: WalkContext): JsonSchema {
  const [base, ...items] = schema.pipe
  const out = walk(base, ctx)
  const baseType = isObject(base) ? base.type : undefined
  const lengthKeyword = baseType === "array" ? "Items" : "Length"
  for (const rawItem of items) {
    if (!isObject(rawItem)) {
      continue
    }
    applyItem(rawItem, out, lengthKeyword, ctx)
  }
  return out
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
  switch (type) {
    case "min_length":
      out[`min${lengthKeyword}`] = requirement
      return
    case "max_length":
      out[`max${lengthKeyword}`] = requirement
      return
    case "length":
      out[`min${lengthKeyword}`] = requirement
      out[`max${lengthKeyword}`] = requirement
      return
    case "non_empty":
      out[`min${lengthKeyword}`] = 1
      return
    case "min_value":
      out.minimum = requirement
      return
    case "max_value":
      out.maximum = requirement
      return
    case "integer":
      out.type = "integer"
      return
    case "multiple_of":
      out.multipleOf = requirement
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
      }
      return
    default:
      ctx.warnings.push(
        `tskm: pipe item "${String(type)}" is not representable in JSON Schema; skipped.`,
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
}

export interface JsonSchemaFile {
  readonly source: string
  readonly output: string
  readonly schemaNames: ReadonlyArray<string>
}

export interface JsonSchemaResult {
  readonly files: ReadonlyArray<JsonSchemaFile>
  readonly diagnostics: ReadonlyArray<string>
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
 * worker protocol import (the structural worker's pattern). A `skipped` entry
 * carries only its reason: its warnings surface, but nothing enters the
 * document for it.
 */
export interface JsonWorkerEntry {
  readonly name: string
  readonly schema: JsonSchema
  readonly warnings: ReadonlyArray<string>
  readonly skipped?: boolean
}

/** The worker's argv[4] protocol: adapter routing context (see jsonschema-adapter.ts). */
export interface JsonWorkerContext {
  readonly io: "input" | "output"
  readonly allowedVendors: ReadonlyArray<string>
}

export async function generateJsonSchema(
  options: JsonSchemaOptions = {},
): Promise<JsonSchemaResult> {
  const root = resolve(options.root ?? process.cwd())
  const config = options.config ? resolveConfig(options.config, root) : await loadConfig(root)
  const workerAbs = resolveWorker("jsonschema-worker")
  const timeoutMs = options.timeoutMs ?? 5000
  const execPath = options.execPath ?? process.execPath
  const workerContext: JsonWorkerContext = {
    io: config.jsonSchema.io,
    allowedVendors: vendorAllowList(config.schemaSources),
  }

  const sources = collectSources(config)
  const files: JsonSchemaFile[] = []
  const diagnostics: string[] = []

  for (const sourceAbs of sources) {
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
      continue
    }

    const schemas = result.envelope.schemas ?? []
    for (const entry of schemas) {
      for (const warning of entry.warnings) {
        diagnostics.push(`tskm: ${sourceAbs}: ${entry.name}: ${warning}`)
      }
    }
    const emittable = schemas.filter((entry) => !entry.skipped)
    if (emittable.length === 0) {
      continue
    }

    const output = jsonSchemaOutputPath(sourceAbs, config)
    const document: Record<string, JsonSchema> = {}
    for (const entry of emittable) {
      document[entry.name] = entry.schema
    }
    writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`)
    files.push({ source: sourceAbs, output, schemaNames: emittable.map((s) => s.name) })
  }

  return { files, diagnostics }
}
