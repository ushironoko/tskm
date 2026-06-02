import { spawnSync } from "node:child_process"
import { existsSync, globSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig, type ResolvedTskmConfig, resolveConfig, type TskmConfig } from "./config.ts"

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

/** Mutable walk context threaded through the recursion (closes over warnings + recursion guard). */
interface WalkContext {
  readonly warnings: string[]
  /** Schema object -> its `$defs` name; an entry means the object was hoisted as a definition. */
  readonly names: Map<object, string>
  readonly defs: Record<string, JsonSchema>
  /** Objects currently on the recursion stack; a re-entry is a cycle and gets hoisted to a `$ref`. */
  readonly visiting: Set<object>
}

function isObject(value: unknown): value is SchemaLike {
  return value !== null && typeof value === "object"
}

/** Pure walker: a runtime tskm schema object -> JSON Schema (draft 2020-12). */
export function schemaToJsonSchema(schema: unknown): SchemaToJsonResult {
  const ctx: WalkContext = {
    warnings: [],
    names: new Map(),
    defs: {},
    visiting: new Set(),
  }
  const out = walk(schema, ctx)
  if (Object.keys(ctx.defs).length > 0) {
    out.$defs = ctx.defs
  }
  return { schema: out, warnings: ctx.warnings }
}

/**
 * Walks one schema, terminating any containment cycle (lazy or hand-built) by hoisting
 * a re-encountered object into `$defs` and emitting a `$ref` to it. A node is only
 * hoisted if it is actually revisited, so acyclic schemas stay fully inlined.
 */
function walk(schema: unknown, ctx: WalkContext): JsonSchema {
  if (!isObject(schema)) {
    ctx.warnings.push(`tskm: cannot convert non-object schema (${String(schema)}); emitting {}.`)
    return {}
  }

  const hoisted = ctx.names.get(schema)
  if (hoisted !== undefined) {
    return { $ref: `#/$defs/${hoisted}` }
  }
  // Back-edge to an ancestor still being built: assign it a name now and reference it;
  // the in-progress walk below will deposit the body into `ctx.defs` on the way out.
  if (ctx.visiting.has(schema)) {
    const name = assignDefName(schema, ctx)
    ctx.names.set(schema, name)
    return { $ref: `#/$defs/${name}` }
  }

  ctx.visiting.add(schema)
  // A piped schema carries the base plus a `pipe: [base, ...items]`. Walk the base and
  // fold each item's constraints onto it; non-representable items warn + skip.
  const body = Array.isArray(schema.pipe)
    ? walkPipe(schema as SchemaLike & { pipe: unknown[] }, ctx)
    : walkSchema(schema, ctx)
  ctx.visiting.delete(schema)

  // If a descendant referenced this node mid-walk, it became a definition: store the
  // body under its name and return a `$ref` instead of inlining a duplicate.
  const assigned = ctx.names.get(schema)
  if (assigned !== undefined) {
    ctx.defs[assigned] = body
    return { $ref: `#/$defs/${assigned}` }
  }
  return body
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
      return walkLazy(schema, ctx)
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

function walkLazy(schema: SchemaLike, ctx: WalkContext): JsonSchema {
  const getter = schema.getter
  if (typeof getter !== "function") {
    ctx.warnings.push("tskm: lazy schema has no getter; emitting {}.")
    return {}
  }
  // The cycle guard lives in `walk`, so a `lazy(() => self)` (or any back-edge through
  // the getter) terminates via a hoisted `$ref` rather than recursing forever.
  const inner = (getter as () => unknown)()
  return walk(inner, ctx)
}

function assignDefName(target: SchemaLike, ctx: WalkContext): string {
  const base = typeof target.type === "string" ? target.type : "schema"
  let candidate = base
  let n = 1
  while (candidate in ctx.defs || hasName(ctx, candidate)) {
    n += 1
    candidate = `${base}_${n}`
  }
  return candidate
}

function hasName(ctx: WalkContext, name: string): boolean {
  for (const value of ctx.names.values()) {
    if (value === name) return true
  }
  return false
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
 * Resolves the sibling worker entry. In source it is `jsonschema-worker.ts`; in the
 * published package it is bundled to `jsonschema-worker.mjs`. Picking whichever exists
 * lets the same code path work from `src` (Bun/vitest) and from `dist`.
 */
function resolveWorker(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const tsEntry = join(here, "jsonschema-worker.ts")
  const mjsEntry = join(here, "jsonschema-worker.mjs")
  return existsSync(mjsEntry) ? mjsEntry : tsEntry
}

interface WorkerEnvelope {
  readonly schemas?: ReadonlyArray<{
    readonly name: string
    readonly schema: JsonSchema
    readonly warnings: ReadonlyArray<string>
  }>
  readonly error?: string
}

export async function generateJsonSchema(
  options: JsonSchemaOptions = {},
): Promise<JsonSchemaResult> {
  const root = resolve(options.root ?? process.cwd())
  const config = options.config ? resolveConfig(options.config, root) : await loadConfig(root)
  const workerAbs = resolveWorker()
  const timeout = options.timeoutMs ?? 5000
  const execPath = options.execPath ?? process.execPath

  const sources = collectSources(config)
  const files: JsonSchemaFile[] = []
  const diagnostics: string[] = []

  let index = 0
  for (const sourceAbs of sources) {
    // The worker writes its envelope to this file rather than stdout, which the imported
    // module is free to pollute (and some runtimes' console.log bypasses stdout patching).
    const envelopeFile = join(tmpdir(), `tskm-jsonschema-${process.pid}-${index++}.json`)
    // Each source imports the user's module — possibly with side effects (DB/network)
    // or an infinite hang — so it runs in a throwaway child the parent can SIGKILL.
    // `spawnSync` is intentional: it gives the timeout/kill semantics we need with the
    // simplest control flow; per-file serialization is acceptable for this experimental path.
    const child = spawnSync(execPath, [workerAbs, sourceAbs, envelopeFile], {
      cwd: root,
      timeout,
      killSignal: "SIGKILL",
      encoding: "utf8",
      env: { ...process.env },
    })

    if (child.error) {
      rmSync(envelopeFile, { force: true })
      diagnostics.push(`tskm: ${sourceAbs}: worker failed (${child.error.message}); skipped.`)
      continue
    }
    if (child.status !== 0) {
      rmSync(envelopeFile, { force: true })
      diagnostics.push(`tskm: ${sourceAbs}: worker exited with code ${child.status}; skipped.`)
      continue
    }

    let envelope: WorkerEnvelope
    try {
      envelope = JSON.parse(readFileSync(envelopeFile, "utf8")) as WorkerEnvelope
    } catch {
      diagnostics.push(`tskm: ${sourceAbs}: could not read worker output; skipped.`)
      continue
    } finally {
      rmSync(envelopeFile, { force: true })
    }

    if (envelope.error) {
      diagnostics.push(`tskm: ${sourceAbs}: ${envelope.error}; skipped.`)
      continue
    }

    const schemas = envelope.schemas ?? []
    if (schemas.length === 0) {
      continue
    }

    const output = jsonSchemaOutputPath(sourceAbs, config)
    const document: Record<string, JsonSchema> = {}
    for (const entry of schemas) {
      document[entry.name] = entry.schema
      for (const warning of entry.warnings) {
        diagnostics.push(`tskm: ${sourceAbs}: ${entry.name}: ${warning}`)
      }
    }
    writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`)
    files.push({ source: sourceAbs, output, schemaNames: schemas.map((s) => s.name) })
  }

  return { files, diagnostics }
}
