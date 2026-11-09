import type { StandardJSONSchemaV1 } from "../types/standard.ts"

/**
 * Standard JSON Schema walker for a runtime tskm schema.
 *
 * Draft 2020-12 output matches the compiler emitter (`schemaToJsonSchema`) for
 * every schema that emitter can represent without a lossy stand-in. The cycle
 * guard is the same algorithm as `packages/compiler/src/cycle-guard.ts`: a node
 * is hoisted into `$defs` only when it is revisited, and acyclic schemas stay
 * inlined. The parity test locks the two walkers together.
 *
 * Directions differ where the runtime value does:
 * - `preprocess` input is `{}` (the input type is `unknown`); output is the
 *   inner schema. Pipe constraints on a preprocess run after the caller's
 *   conversion, so they belong to the output only.
 * - `optional` / `nullable` / `nullish` put a JSON `default` on the input when
 *   the default is a JSON value. Output omits it (the default has been applied).
 * - `fallback` puts that value on the output only (it recovers a failed parse).
 * - `transform` output throws: the result type is not reified. Input stops
 *   before the transform and still describes the incoming value.
 *
 * `brand` and `readonly` do not change the JSON value, so they are skipped.
 * `check`, `bigint`, `date`, `undefined`, and unknown kinds throw. The compiler
 * emitter refuses the same types by default and approximates one only when the
 * caller opts in (`jsonSchema.approximate`); this walker never approximates.
 */

export type JsonSchema = { [key: string]: unknown }

const SUPPORTED_TARGETS = ["draft-2020-12", "draft-07", "openapi-3.0"] as const
type SupportedTarget = (typeof SUPPORTED_TARGETS)[number]

interface SchemaLike {
  readonly type?: unknown
  readonly pipe?: unknown
  readonly kind?: unknown
  readonly [key: string]: unknown
}

interface CycleGuardState {
  readonly visiting: Set<object>
  readonly names: Map<object, string>
}

interface WalkContext {
  readonly io: "input" | "output"
  readonly target: SupportedTarget
  readonly defs: Record<string, JsonSchema>
  readonly guard: CycleGuardState
  readonly exportNames: ReadonlyMap<object, string> | undefined
}

function fail(message: string): never {
  throw new Error(`tskm: ${message}`)
}

function isObject(value: unknown): value is SchemaLike {
  return value !== null && typeof value === "object"
}

function createCycleGuard(): CycleGuardState {
  return { visiting: new Set(), names: new Map() }
}

interface CycleWalkHooks {
  readonly emitRef: (name: string) => JsonSchema
  readonly storeDef: (name: string, body: JsonSchema) => void
  readonly hasDef: (name: string) => boolean
  readonly baseName: (schema: object) => string
  readonly walkBody: (schema: object) => JsonSchema
}

function walkWithCycleGuard(
  schema: object,
  state: CycleGuardState,
  hooks: CycleWalkHooks,
): JsonSchema {
  const hoisted = state.names.get(schema)
  if (hoisted !== undefined) {
    return hooks.emitRef(hoisted)
  }
  if (state.visiting.has(schema)) {
    const name = assignDefName(schema, state, hooks)
    state.names.set(schema, name)
    return hooks.emitRef(name)
  }

  state.visiting.add(schema)
  const body = hooks.walkBody(schema)
  state.visiting.delete(schema)

  const assigned = state.names.get(schema)
  if (assigned !== undefined) {
    hooks.storeDef(assigned, body)
    return hooks.emitRef(assigned)
  }
  return body
}

function hasName(state: CycleGuardState, name: string): boolean {
  for (const value of state.names.values()) {
    if (value === name) {
      return true
    }
  }
  return false
}

function assignDefName(schema: object, state: CycleGuardState, hooks: CycleWalkHooks): string {
  const base = hooks.baseName(schema)
  let candidate = base
  let n = 1
  while (hooks.hasDef(candidate) || hasName(state, candidate)) {
    n += 1
    candidate = `${base}_${n}`
  }
  return candidate
}

function isSupportedTarget(target: string): target is SupportedTarget {
  return (SUPPORTED_TARGETS as readonly string[]).includes(target)
}

function readOptions(options: StandardJSONSchemaV1.Options): {
  readonly target: SupportedTarget
  readonly name: string | undefined
} {
  if (options === null || typeof options !== "object") {
    fail("jsonSchema options must be an object with a target")
  }
  const { target, libraryOptions } = options
  if (!isSupportedTarget(target)) {
    fail(
      `unsupported JSON Schema target ${JSON.stringify(target)}. Supported targets: ${SUPPORTED_TARGETS.map((item) => JSON.stringify(item)).join(", ")}.`,
    )
  }
  if (libraryOptions === undefined) {
    return { target, name: undefined }
  }
  if (
    libraryOptions === null ||
    typeof libraryOptions !== "object" ||
    Array.isArray(libraryOptions)
  ) {
    fail("jsonSchema libraryOptions must be a plain object when provided")
  }
  if (!("name" in libraryOptions) || libraryOptions.name === undefined) {
    return { target, name: undefined }
  }
  const name = libraryOptions.name
  if (typeof name !== "string" || name.length === 0 || name.includes("/") || name.includes("#")) {
    fail('jsonSchema libraryOptions.name must be a non-empty string without "/" or "#"')
  }
  return { target, name }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== "object" || typeof right !== "object") return false
  if (left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) {
      if (!jsonEqual(left[index], right[index])) return false
    }
    return true
  }
  if (Object.getPrototypeOf(left) !== Object.prototype) return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.hasOwn(rightRecord, key) || !jsonEqual(leftRecord[key], rightRecord[key])) {
      return false
    }
  }
  return true
}

/** A default keyword value, or a throw when the runtime default is not JSON. */
function jsonDefault(value: unknown): unknown {
  if (typeof value === "function") {
    fail("cannot represent a default value in JSON Schema: the default is a function")
  }
  if (typeof value === "bigint") {
    fail("cannot represent a default value in JSON Schema: the default is a bigint")
  }
  if (typeof value === "symbol") {
    fail("cannot represent a default value in JSON Schema: the default is a symbol")
  }
  if (typeof value === "undefined") {
    fail("cannot represent a default value in JSON Schema: the default is undefined")
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    fail("cannot represent a default value in JSON Schema: the default is not a finite number")
  }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    fail(
      `cannot represent a default value in JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const parsed: unknown = JSON.parse(serialized)
  if (!jsonEqual(value, parsed)) {
    fail(
      "cannot represent a default value in JSON Schema: the value does not round-trip through JSON",
    )
  }
  return parsed
}

function withInputDefault(body: JsonSchema, defaultValue: unknown, ctx: WalkContext): JsonSchema {
  if (ctx.io !== "input" || defaultValue === undefined) return body
  return { ...body, default: jsonDefault(defaultValue) }
}

export function convertToJsonSchema(
  schema: unknown,
  io: "input" | "output",
  options: StandardJSONSchemaV1.Options,
): Record<string, unknown> {
  const { target, name } = readOptions(options)
  const exportNames =
    name !== undefined && isObject(schema) ? new Map<object, string>([[schema, name]]) : undefined
  const ctx: WalkContext = {
    io,
    target,
    defs: {},
    guard: createCycleGuard(),
    exportNames,
  }
  const out = walk(schema, ctx)
  if (Object.keys(ctx.defs).length > 0) {
    out.$defs = ctx.defs
  }
  if (target === "draft-2020-12") return out
  return rewriteValue(out, target) as Record<string, unknown>
}

function walk(schema: unknown, ctx: WalkContext): JsonSchema {
  if (!isObject(schema)) {
    fail(`cannot convert non-object schema (${String(schema)}) to JSON Schema`)
  }
  return walkWithCycleGuard(schema, ctx.guard, {
    emitRef: (name) => ({ $ref: `#/$defs/${name}` }),
    storeDef: (name, body) => {
      ctx.defs[name] = body
    },
    hasDef: (name) => name in ctx.defs,
    baseName: (target) => {
      const fromExport = ctx.exportNames?.get(target)
      if (fromExport !== undefined) return fromExport
      const type = (target as SchemaLike).type
      return typeof type === "string" ? type : "schema"
    },
    walkBody: (target) => {
      const node = target as SchemaLike
      return Array.isArray(node.pipe)
        ? walkPipe(node as SchemaLike & { pipe: unknown[] }, ctx)
        : walkSchema(node, ctx)
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
      return fail(
        'cannot convert schema type "bigint" to JSON Schema: bigint has no JSON representation',
      )
    case "date":
      return fail(
        'cannot convert schema type "date" to JSON Schema: Date has no JSON representation',
      )
    case "null":
      return { type: "null" }
    case "undefined":
      return fail(
        'cannot convert schema type "undefined" to JSON Schema: undefined has no JSON representation',
      )
    case "any":
    case "unknown":
      return {}
    case "never":
      return { not: {} }
    case "literal":
      return { const: schema.literal }
    case "picklist":
      if (!Array.isArray(schema.options)) {
        fail('cannot convert schema type "picklist" to JSON Schema: options is not an array')
      }
      return { enum: schema.options }
    case "object":
      return walkObject(schema, ctx)
    case "array":
      if (!isObject(schema.item)) {
        fail('cannot convert schema type "array" to JSON Schema: item is not a schema')
      }
      return { type: "array", items: walk(schema.item, ctx) }
    case "record": {
      if (!isObject(schema.value)) {
        fail('cannot convert schema type "record" to JSON Schema: value is not a schema')
      }
      const recordValue = walk(schema.value, ctx)
      if (isObject(schema.key)) {
        return {
          type: "object",
          additionalProperties: recordValue,
          propertyNames: walk(schema.key, ctx),
        }
      }
      return { type: "object", additionalProperties: recordValue }
    }
    case "tuple": {
      if (!Array.isArray(schema.items)) {
        fail('cannot convert schema type "tuple" to JSON Schema: items is not an array')
      }
      return {
        type: "array",
        prefixItems: schema.items.map((item) => walk(item, ctx)),
        items: false,
      }
    }
    case "union": {
      if (!Array.isArray(schema.options)) {
        fail('cannot convert schema type "union" to JSON Schema: options is not an array')
      }
      return { anyOf: schema.options.map((option) => walk(option, ctx)) }
    }
    case "discriminated_union": {
      if (!Array.isArray(schema.options)) {
        fail(
          'cannot convert schema type "discriminated_union" to JSON Schema: options is not an array',
        )
      }
      const result: JsonSchema = {
        oneOf: schema.options.map((option) => walk(option, ctx)),
      }
      if (typeof schema.discriminant === "string") {
        result["x-tskm-discriminant"] = schema.discriminant
      }
      return result
    }
    case "templateLiteral": {
      const ext = typeof schema.expects === "string" ? schema.expects : true
      return typeof schema.pattern === "string"
        ? { type: "string", pattern: schema.pattern, "x-tskm-template": ext }
        : { type: "string", "x-tskm-template": ext }
    }
    case "optional": {
      const inner = walk(schema.wrapped, ctx)
      return withInputDefault(inner, schema.default, ctx)
    }
    case "nullable": {
      const inner = walk(schema.wrapped, ctx)
      return withInputDefault({ anyOf: [inner, { type: "null" }] }, schema.default, ctx)
    }
    case "nullish": {
      const inner = walk(schema.wrapped, ctx)
      return withInputDefault({ anyOf: [inner, { type: "null" }] }, schema.default, ctx)
    }
    case "preprocess":
      if (ctx.io === "input") return {}
      return walk(schema.wrapped, ctx)
    case "fallback": {
      const inner = walk(schema.wrapped, ctx)
      if (ctx.io === "input") return inner
      return { ...inner, default: jsonDefault(schema.fallback) }
    }
    case "lazy":
    case "recursive":
      return walkDeferred(schema, ctx)
    default:
      fail(
        `cannot convert schema type "${String(type)}" to JSON Schema: this schema kind has no JSON Schema representation`,
      )
  }
}

function walkObject(schema: SchemaLike, ctx: WalkContext): JsonSchema {
  if (!isObject(schema.entries)) {
    fail('cannot convert schema type "object" to JSON Schema: entries is not an object')
  }
  const entries = schema.entries
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const key of Object.keys(entries)) {
    const entry = entries[key]
    properties[key] = walk(entry, ctx)
    const entryType = isObject(entry) ? entry.type : undefined
    if (entryType !== "optional" && entryType !== "nullish") {
      required.push(key)
    }
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: schema.rest === "passthrough",
  }
}

function walkDeferred(schema: SchemaLike, ctx: WalkContext): JsonSchema {
  const getter = schema.getter
  if (typeof getter !== "function") {
    fail(`cannot convert schema type "${String(schema.type)}" to JSON Schema: it has no getter`)
  }
  return walk(getter(), ctx)
}

function isTransformItem(item: SchemaLike): boolean {
  return item.kind === "transformation" && item.type === "transform"
}

function walkPipe(schema: SchemaLike & { pipe: unknown[] }, ctx: WalkContext): JsonSchema {
  const [base, ...items] = schema.pipe
  if (!isObject(base)) {
    fail("cannot convert a pipe whose base is not a schema object")
  }
  // Constraints on a preprocess validate the value the operation produced, not the raw input.
  if (ctx.io === "input" && base.type === "preprocess") {
    return {}
  }

  const transformAt = items.findIndex((item) => isObject(item) && isTransformItem(item))
  if (ctx.io === "output" && transformAt !== -1) {
    fail(
      'cannot convert pipe item "transform" to JSON Schema output: the transform\'s output type is not reified at runtime. input() still describes the schema before the transform',
    )
  }

  const out = walk(base, ctx)
  const lengthKeyword = base.type === "array" ? "Items" : "Length"
  for (let index = 0; index < items.length; index++) {
    const rawItem = items[index]
    if (!isObject(rawItem)) {
      fail("cannot convert a non-object pipe item to JSON Schema")
    }
    if (ctx.io === "input" && transformAt !== -1 && index >= transformAt) {
      if (rawItem.type === "description" && typeof rawItem.requirement === "string") {
        out.description = rawItem.requirement
      }
      continue
    }
    applyItem(rawItem, out, lengthKeyword)
  }
  return out
}

function applyItem(item: SchemaLike, out: JsonSchema, lengthKeyword: "Items" | "Length"): void {
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
        return
      }
      fail('cannot convert pipe item "regex" to JSON Schema: requirement is not a RegExp')
      return
    case "description":
      if (typeof requirement === "string") {
        out.description = requirement
      }
      return
    case "brand":
    case "readonly":
      return
    case "check":
      fail(
        'cannot convert pipe item "check" to JSON Schema: a function predicate has no JSON Schema representation',
      )
      return
    case "transform":
      fail(
        'cannot convert pipe item "transform" to JSON Schema output: the transform\'s output type is not reified at runtime. input() still describes the schema before the transform',
      )
      return
    default:
      fail(
        `cannot convert pipe item "${String(type)}" to JSON Schema: it has no JSON Schema representation`,
      )
      return
  }
}

function rewriteDefs(defs: SchemaLike, target: "draft-07" | "openapi-3.0"): JsonSchema {
  const out: JsonSchema = {}
  for (const [key, def] of Object.entries(defs)) {
    out[key] = rewriteValue(def, target) as JsonSchema
  }
  return out
}

function rewriteValue(value: unknown, target: "draft-07" | "openapi-3.0"): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, target))
  if (!isObject(value)) return value
  return target === "draft-07" ? rewriteDraft07(value) : rewriteOpenApi(value)
}

function rewriteDraft07(node: JsonSchema): JsonSchema {
  const out: JsonSchema = {}
  const hasPrefix = Array.isArray(node.prefixItems)
  for (const [key, value] of Object.entries(node)) {
    if (key === "prefixItems" && Array.isArray(value)) {
      out.items = value.map((item) => rewriteValue(item, "draft-07"))
      continue
    }
    if (key === "items" && hasPrefix) {
      // Tuples are closed (`items: false` in draft 2020-12).
      out.additionalItems = false
      continue
    }
    if (key === "$defs" && isObject(value)) {
      out.definitions = rewriteDefs(value, "draft-07")
      continue
    }
    if (key === "$ref" && typeof value === "string") {
      out.$ref = value.replace("#/$defs/", "#/definitions/")
      continue
    }
    out[key] = rewriteValue(value, "draft-07")
  }
  return out
}

function isExactNull(value: unknown): boolean {
  return isObject(value) && Object.keys(value).length === 1 && value.type === "null"
}

function openApiNull(): JsonSchema {
  return { type: "string", nullable: true, enum: [null] }
}

function withNullable(base: JsonSchema): JsonSchema {
  // OpenAPI 3.0 ignores keywords next to `$ref`, so a nullable reference is an allOf.
  if (typeof base.$ref === "string" && Object.keys(base).length === 1) {
    return { allOf: [base], nullable: true }
  }
  return { ...base, nullable: true }
}

function rewriteOpenApi(node: JsonSchema): JsonSchema {
  if (Array.isArray(node.anyOf)) {
    const members = node.anyOf
    const nullMembers = members.filter(isExactNull)
    const rest = members.filter((member) => !isExactNull(member))
    if (nullMembers.length > 0 && rest.length === 0) {
      return openApiNull()
    }
    if (nullMembers.length > 0 && rest.length > 0) {
      const rewrittenRest = rest.map((member) => rewriteValue(member, "openapi-3.0"))
      const base = withNullable(
        rewrittenRest.length === 1
          ? (rewrittenRest[0] as JsonSchema)
          : { anyOf: rewrittenRest as JsonSchema[] },
      )
      for (const [key, value] of Object.entries(node)) {
        if (key === "anyOf") continue
        base[key] = rewriteValue(value, "openapi-3.0") as never
      }
      return base
    }
  }

  const out: JsonSchema = {}
  const hasPrefix = Array.isArray(node.prefixItems)
  for (const [key, value] of Object.entries(node)) {
    if (key === "propertyNames") {
      return fail(
        'cannot convert a record key constraint to JSON Schema target "openapi-3.0": propertyNames is not part of OpenAPI 3.0',
      )
    }
    if (key === "prefixItems" && Array.isArray(value)) {
      const prefix = value.map((item) => rewriteValue(item, "openapi-3.0"))
      // `anyOf` drops positions, so the tuple length is carried as min/max items.
      out.items = { anyOf: prefix }
      out.minItems = prefix.length
      out.maxItems = prefix.length
      continue
    }
    if (key === "items" && hasPrefix) continue
    if (key === "$defs" && isObject(value)) {
      out.definitions = rewriteDefs(value, "openapi-3.0")
      continue
    }
    if (key === "$ref" && typeof value === "string") {
      out.$ref = value.replace("#/$defs/", "#/definitions/")
      continue
    }
    if (key === "const") {
      out.enum = [value]
      if (out.type === undefined && node.type === undefined) {
        out.type = value === null ? "null" : typeof value
      }
      continue
    }
    out[key] = rewriteValue(value, "openapi-3.0")
  }
  if (isExactNull(out)) return openApiNull()
  if (
    out.type === "null" &&
    Array.isArray(out.enum) &&
    out.enum.length === 1 &&
    out.enum[0] === null
  ) {
    return openApiNull()
  }
  return out
}
