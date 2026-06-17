import type { SafeParseResult } from "./methods/safeParse.ts"
import { array } from "./schemas/array.ts"
import { boolean } from "./schemas/boolean.ts"
import { nullish } from "./schemas/nullish.ts"
import { number } from "./schemas/number.ts"
import { _applyRest, type ObjectEntries, object, type RestMode } from "./schemas/object.ts"
import { optional } from "./schemas/optional.ts"
import { string } from "./schemas/string.ts"
import type { Config } from "./types/config.ts"
import { defaultConfig, isReject } from "./types/config.ts"
import type { OutputDataset, UnknownDataset } from "./types/dataset.ts"
import type { InferOutput } from "./types/infer.ts"
import type { Issue, IssuePathItem } from "./types/issue.ts"
import type { BaseSchema } from "./types/schema.ts"
import { _addIssue } from "./utils/_addIssue.ts"
import { _safeAssign } from "./utils/_safeAssign.ts"
import { hasErrorIssue, isWarningIssue } from "./utils/_severity.ts"

export interface Cursor {
  value: unknown
  typed: boolean
  issues: Issue[]
  config: Config
}

export type Step = (c: Cursor) => void

type CompilableSchema = BaseSchema<unknown, unknown> & {
  readonly pipe?: unknown
  readonly entries?: ObjectEntries
  readonly item?: BaseSchema<unknown, unknown>
  readonly wrapped?: BaseSchema<unknown, unknown>
  readonly message?: string | undefined
  readonly optionalKeys?: boolean | undefined
  readonly rest?: RestMode | undefined
  readonly default?: unknown
}

const compiledCache: WeakMap<object, Step> = new WeakMap()
type DatasetView = UnknownDataset | OutputDataset<unknown>

export function getCompiledValidate<const TSchema extends BaseSchema<unknown, unknown>>(
  schema: TSchema,
): Step {
  const cached = compiledCache.get(schema)
  if (cached !== undefined) {
    return cached
  }
  const step = compile(schema as CompilableSchema)
  compiledCache.set(schema, step)
  return step
}

/**
 * Opt-in compiled fast path: validates `input` against a pre-compiled closure tree instead
 * of walking the schema tree interpretively, returning the same {@link SafeParseResult} as
 * {@link safeParse} (byte-identical value and issues — see `bench/validator/conformance.ts`).
 * No `eval`/codegen, so it runs unchanged under a strict CSP and on edge runtimes.
 *
 * The byte-identical guarantee covers every schema built through tskm's public factory API.
 * Specialization keys on factory identity (`schema.reference`), so an honest foreign/custom
 * schema with a colliding `type` string still runs its own `~run` (no bypass). A schema that
 * DELIBERATELY forges a native `reference` while diverging in `~run` is out of contract — see
 * the TRUST BOUNDARY note in {@link compile}.
 *
 * Intended for CONTAINER schemas (object/array and their nestings), where it removes the
 * megamorphic per-node dispatch and the per-value dataset allocation and wins ~1.8-3x on
 * object/array-heavy payloads (primitive leaves inside a container are inlined here with no
 * wrapper cost).
 *
 * A BARE TOP-LEVEL PRIMITIVE (`string()`/`number()`/`boolean()`) should be validated with
 * {@link safeParse} directly: its compiled Step does the same single `typeof` check the
 * interpreter does, so going through this extra entry point is a small constant overhead
 * (~1.2x on a sub-25ns parse) with nothing to amortize it. That overhead is the cost of the
 * separate entry, not of compilation, so it cannot be removed by delegating internally.
 */
export function safeParseCompiled<const TSchema extends BaseSchema<unknown, unknown>>(
  schema: TSchema,
  input: unknown,
  config: Config = defaultConfig,
): SafeParseResult<TSchema> {
  const step = getCompiledValidate(schema)
  const cursor: Cursor = { value: input, typed: true, issues: [], config }
  step(cursor)
  if (cursor.issues.length === 0) {
    return {
      success: true,
      output: cursor.value as InferOutput<TSchema>,
      issues: undefined,
      warnings: [],
    }
  }
  const issues = cursor.issues
  const warnings = issues.filter(isWarningIssue)
  if (hasErrorIssue(issues)) {
    return { success: false, output: cursor.value, issues, warnings }
  }
  return {
    success: true,
    output: cursor.value as InferOutput<TSchema>,
    issues: undefined,
    warnings,
  }
}

function compile(schema: CompilableSchema): Step {
  if ((schema as { readonly async: boolean }).async === true || schema.pipe !== undefined) {
    return compileFallback(schema)
  }
  // Specialize ONLY genuine native tskm factory outputs, keyed on factory identity
  // (`schema.reference`) — NEVER on the public `schema.type` string. `BaseSchema` is
  // structural and `type` is public, so an honest foreign/custom schema can carry a colliding
  // `type` (e.g. "string") together with a stricter `~run`; dispatching on the string would
  // specialize it and silently bypass that `~run`, accepting input the interpreter rejects. A
  // value-only `type` collision cannot reach a specialized path here (factory identity differs),
  // so honest foreign schemas fall through to `compileFallback`, which runs their own `~run`.
  //
  // TRUST BOUNDARY: `reference` is itself a public, copyable field, so a schema can DELIBERATELY
  // impersonate a native factory's identity while diverging in `~run`. Such a forgery is OUT of
  // the byte-identical contract — an accepted non-goal, not an honest-code bypass: every schema
  // built through tskm's public factory API has BOTH the native `reference` AND the matching
  // `~run`. Closing even the forgery would require a module-private brand registered by each
  // native factory, coupling the core factories to this opt-in compiler; intentionally not done.
  switch (schema.reference) {
    case object:
      return compileObject(schema)
    case array:
      return compileArray(schema)
    case string:
      return compileString(schema)
    case number:
      return compileNumber(schema)
    case boolean:
      return compileBoolean(schema)
    case optional:
      return compileOptional(schema)
    case nullish:
      return compileNullish(schema)
    default:
      return compileFallback(schema)
  }
}

function compileObject(schema: CompilableSchema): Step {
  const entries = schema.entries
  if (entries === undefined) {
    return compileFallback(schema)
  }
  const keys = Object.keys(entries)
  const len = keys.length
  const childSteps: Step[] = new Array(len)
  const childTypes: string[] = new Array(len)
  const childCodes: number[] = new Array(len)
  const childMessages: (string | undefined)[] = new Array(len)
  const optionalChildren: boolean[] = new Array(len)
  const protoKeys: boolean[] = new Array(len)
  for (let i = 0; i < len; i++) {
    const key = keys[i] as string
    const child = entries[key]
    if (child === undefined) {
      return compileFallback(schema)
    }
    childSteps[i] = getCompiledValidate(child)
    childTypes[i] = child.type
    childCodes[i] = primitiveCode(child as CompilableSchema)
    childMessages[i] = (child as CompilableSchema).message
    optionalChildren[i] = child.type === "optional" || child.type === "nullish"
    protoKeys[i] = key === "__proto__"
  }
  const message = schema.message
  const optionalKeys = schema.optionalKeys === true
  const rest = schema.rest ?? "strip"
  if (allPrimitiveCodes(childCodes)) {
    if (rest === "strip" && noProtoKeys(protoKeys)) {
      if (len === 3) {
        return compilePrimitiveObject3Strip(keys, childCodes, childMessages, message)
      }
      if (len === 5) {
        return compilePrimitiveObject5Strip(keys, childCodes, childMessages, message)
      }
    }
    return compilePrimitiveObject(
      entries,
      keys,
      childCodes,
      childMessages,
      protoKeys,
      rest,
      message,
    )
  }

  return (c) => {
    const input = c.value
    if (input !== null && typeof input === "object" && !Array.isArray(input)) {
      const record = input as Record<string, unknown>
      const output: Record<string, unknown> = {}
      let objectTyped = true
      let aborted = false

      for (let i = 0; i < len; i++) {
        const key = keys[i] as string
        const step = childSteps[i] as Step
        const code = childCodes[i] as number
        const mark = c.issues.length
        c.value = record[key]
        c.typed = true
        if (code === 1) {
          if (typeof c.value === "string") {
            c.typed = true
          } else {
            _addIssue(
              cursorDataset(c),
              {
                kind: "schema",
                type: "string",
                expected: "string",
                message: childMessages[i],
              },
              c.config,
            )
          }
        } else if (code === 2) {
          if (typeof c.value === "number" && !Number.isNaN(c.value)) {
            c.typed = true
          } else {
            _addIssue(
              cursorDataset(c),
              {
                kind: "schema",
                type: "number",
                expected: "number",
                message: childMessages[i],
              },
              c.config,
            )
          }
        } else if (code === 3) {
          if (typeof c.value === "boolean") {
            c.typed = true
          } else {
            _addIssue(
              cursorDataset(c),
              {
                kind: "schema",
                type: "boolean",
                expected: "boolean",
                message: childMessages[i],
              },
              c.config,
            )
          }
        } else {
          step(c)
        }

        if (c.issues.length > mark) {
          prefixIssuePaths(c.issues, mark, key)
          if (hasErrorIssueFrom(c.issues, mark) && isReject(c.config)) {
            objectTyped = false
            aborted = true
            break
          }
        }
        if (!c.typed) {
          objectTyped = false
        }
        if (optionalKeys && c.value === undefined && (optionalChildren[i] as boolean)) {
          continue
        }
        if (protoKeys[i] as boolean) {
          _safeAssign(output, key, c.value)
        } else {
          output[key] = c.value
        }
      }

      c.value = input
      c.typed = objectTyped
      if (!aborted && rest !== "strip") {
        aborted = _applyRest(cursorDataset(c), record, entries, output, rest, message, c.config)
      }
      if (!aborted) {
        c.value = output
      } else {
        c.value = input
        c.typed = false
      }
    } else {
      _addIssue(
        cursorDataset(c),
        { kind: "schema", type: "object", expected: "Object", message },
        c.config,
      )
    }
  }
}

function compilePrimitiveObject3Strip(
  keys: readonly string[],
  childCodes: readonly number[],
  childMessages: readonly (string | undefined)[],
  message: string | undefined,
): Step {
  const k0 = keys[0] as string
  const k1 = keys[1] as string
  const k2 = keys[2] as string
  const c0 = childCodes[0] as number
  const c1 = childCodes[1] as number
  const c2 = childCodes[2] as number
  const m0 = childMessages[0]
  const m1 = childMessages[1]
  const m2 = childMessages[2]
  return (c) => {
    const input = c.value
    if (input !== null && typeof input === "object" && !Array.isArray(input)) {
      const record = input as Record<string, unknown>
      const output: Record<string, unknown> = {}
      let objectTyped = true

      const v0 = record[k0]
      if (
        c0 === 1
          ? typeof v0 === "string"
          : c0 === 2
            ? typeof v0 === "number" && !Number.isNaN(v0)
            : typeof v0 === "boolean"
      ) {
        output[k0] = v0
      } else {
        objectTyped = false
        if (addPrimitiveObjectIssue(c, c0, m0, k0, v0)) {
          c.value = input
          c.typed = false
          return
        }
        output[k0] = v0
      }

      const v1 = record[k1]
      if (
        c1 === 1
          ? typeof v1 === "string"
          : c1 === 2
            ? typeof v1 === "number" && !Number.isNaN(v1)
            : typeof v1 === "boolean"
      ) {
        output[k1] = v1
      } else {
        objectTyped = false
        if (addPrimitiveObjectIssue(c, c1, m1, k1, v1)) {
          c.value = input
          c.typed = false
          return
        }
        output[k1] = v1
      }

      const v2 = record[k2]
      if (
        c2 === 1
          ? typeof v2 === "string"
          : c2 === 2
            ? typeof v2 === "number" && !Number.isNaN(v2)
            : typeof v2 === "boolean"
      ) {
        output[k2] = v2
      } else {
        objectTyped = false
        if (addPrimitiveObjectIssue(c, c2, m2, k2, v2)) {
          c.value = input
          c.typed = false
          return
        }
        output[k2] = v2
      }

      c.value = output
      c.typed = objectTyped
    } else {
      _addIssue(
        cursorDataset(c),
        { kind: "schema", type: "object", expected: "Object", message },
        c.config,
      )
    }
  }
}

function compilePrimitiveObject5Strip(
  keys: readonly string[],
  childCodes: readonly number[],
  childMessages: readonly (string | undefined)[],
  message: string | undefined,
): Step {
  const k0 = keys[0] as string
  const k1 = keys[1] as string
  const k2 = keys[2] as string
  const k3 = keys[3] as string
  const k4 = keys[4] as string
  const c0 = childCodes[0] as number
  const c1 = childCodes[1] as number
  const c2 = childCodes[2] as number
  const c3 = childCodes[3] as number
  const c4 = childCodes[4] as number
  const m0 = childMessages[0]
  const m1 = childMessages[1]
  const m2 = childMessages[2]
  const m3 = childMessages[3]
  const m4 = childMessages[4]
  return (c) => {
    const input = c.value
    if (input !== null && typeof input === "object" && !Array.isArray(input)) {
      const record = input as Record<string, unknown>
      const output: Record<string, unknown> = {}
      let objectTyped = true

      const v0 = record[k0]
      if (
        c0 === 1
          ? typeof v0 === "string"
          : c0 === 2
            ? typeof v0 === "number" && !Number.isNaN(v0)
            : typeof v0 === "boolean"
      ) {
        output[k0] = v0
      } else {
        objectTyped = false
        if (addPrimitiveObjectIssue(c, c0, m0, k0, v0)) {
          c.value = input
          c.typed = false
          return
        }
        output[k0] = v0
      }

      const v1 = record[k1]
      if (
        c1 === 1
          ? typeof v1 === "string"
          : c1 === 2
            ? typeof v1 === "number" && !Number.isNaN(v1)
            : typeof v1 === "boolean"
      ) {
        output[k1] = v1
      } else {
        objectTyped = false
        if (addPrimitiveObjectIssue(c, c1, m1, k1, v1)) {
          c.value = input
          c.typed = false
          return
        }
        output[k1] = v1
      }

      const v2 = record[k2]
      if (
        c2 === 1
          ? typeof v2 === "string"
          : c2 === 2
            ? typeof v2 === "number" && !Number.isNaN(v2)
            : typeof v2 === "boolean"
      ) {
        output[k2] = v2
      } else {
        objectTyped = false
        if (addPrimitiveObjectIssue(c, c2, m2, k2, v2)) {
          c.value = input
          c.typed = false
          return
        }
        output[k2] = v2
      }

      const v3 = record[k3]
      if (
        c3 === 1
          ? typeof v3 === "string"
          : c3 === 2
            ? typeof v3 === "number" && !Number.isNaN(v3)
            : typeof v3 === "boolean"
      ) {
        output[k3] = v3
      } else {
        objectTyped = false
        if (addPrimitiveObjectIssue(c, c3, m3, k3, v3)) {
          c.value = input
          c.typed = false
          return
        }
        output[k3] = v3
      }

      const v4 = record[k4]
      if (
        c4 === 1
          ? typeof v4 === "string"
          : c4 === 2
            ? typeof v4 === "number" && !Number.isNaN(v4)
            : typeof v4 === "boolean"
      ) {
        output[k4] = v4
      } else {
        objectTyped = false
        if (addPrimitiveObjectIssue(c, c4, m4, k4, v4)) {
          c.value = input
          c.typed = false
          return
        }
        output[k4] = v4
      }

      c.value = output
      c.typed = objectTyped
    } else {
      _addIssue(
        cursorDataset(c),
        { kind: "schema", type: "object", expected: "Object", message },
        c.config,
      )
    }
  }
}

function compilePrimitiveObject(
  entries: ObjectEntries,
  keys: readonly string[],
  childCodes: readonly number[],
  childMessages: readonly (string | undefined)[],
  protoKeys: readonly boolean[],
  rest: RestMode,
  message: string | undefined,
): Step {
  const len = keys.length
  return (c) => {
    const input = c.value
    if (input !== null && typeof input === "object" && !Array.isArray(input)) {
      const record = input as Record<string, unknown>
      const output: Record<string, unknown> = {}
      let objectTyped = true
      let aborted = false

      for (let i = 0; i < len; i++) {
        const key = keys[i] as string
        const value = record[key]
        const code = childCodes[i] as number
        let valid = false
        if (code === 1) {
          valid = typeof value === "string"
        } else if (code === 2) {
          valid = typeof value === "number" && !Number.isNaN(value)
        } else {
          valid = typeof value === "boolean"
        }

        if (!valid) {
          const mark = c.issues.length
          c.value = value
          c.typed = true
          if (code === 1) {
            _addIssue(
              cursorDataset(c),
              {
                kind: "schema",
                type: "string",
                expected: "string",
                message: childMessages[i],
              },
              c.config,
            )
          } else if (code === 2) {
            _addIssue(
              cursorDataset(c),
              {
                kind: "schema",
                type: "number",
                expected: "number",
                message: childMessages[i],
              },
              c.config,
            )
          } else {
            _addIssue(
              cursorDataset(c),
              {
                kind: "schema",
                type: "boolean",
                expected: "boolean",
                message: childMessages[i],
              },
              c.config,
            )
          }
          prefixIssuePaths(c.issues, mark, key)
          objectTyped = false
          if (isReject(c.config)) {
            aborted = true
            break
          }
        }

        if (protoKeys[i] as boolean) {
          _safeAssign(output, key, value)
        } else {
          output[key] = value
        }
      }

      c.value = input
      c.typed = objectTyped
      if (!aborted && rest !== "strip") {
        aborted = _applyRest(cursorDataset(c), record, entries, output, rest, message, c.config)
      }
      if (!aborted) {
        c.value = output
      } else {
        c.value = input
        c.typed = false
      }
    } else {
      _addIssue(
        cursorDataset(c),
        { kind: "schema", type: "object", expected: "Object", message },
        c.config,
      )
    }
  }
}

function compileArray(schema: CompilableSchema): Step {
  const item = schema.item
  if (item === undefined) {
    return compileFallback(schema)
  }
  const itemStep = getCompiledValidate(item)
  const itemCode = primitiveCode(item as CompilableSchema)
  const itemMessage = (item as CompilableSchema).message
  const message = schema.message

  return (c) => {
    const input = c.value
    if (Array.isArray(input)) {
      const output: unknown[] = []
      let arrayTyped = true
      let aborted = false
      for (let index = 0; index < input.length; index++) {
        const mark = c.issues.length
        c.value = input[index]
        c.typed = true
        if (itemCode === 1) {
          if (typeof c.value === "string") {
            c.typed = true
          } else {
            _addIssue(
              cursorDataset(c),
              { kind: "schema", type: "string", expected: "string", message: itemMessage },
              c.config,
            )
          }
        } else if (itemCode === 2) {
          if (typeof c.value === "number" && !Number.isNaN(c.value)) {
            c.typed = true
          } else {
            _addIssue(
              cursorDataset(c),
              { kind: "schema", type: "number", expected: "number", message: itemMessage },
              c.config,
            )
          }
        } else if (itemCode === 3) {
          if (typeof c.value === "boolean") {
            c.typed = true
          } else {
            _addIssue(
              cursorDataset(c),
              { kind: "schema", type: "boolean", expected: "boolean", message: itemMessage },
              c.config,
            )
          }
        } else {
          itemStep(c)
        }
        if (c.issues.length > mark) {
          prefixIssuePaths(c.issues, mark, index)
          if (hasErrorIssueFrom(c.issues, mark) && isReject(c.config)) {
            arrayTyped = false
            aborted = true
            break
          }
        }
        if (!c.typed) {
          arrayTyped = false
        }
        output.push(c.value)
      }
      c.typed = arrayTyped
      if (!aborted) {
        c.value = output
      } else {
        c.value = input
        c.typed = false
      }
    } else {
      _addIssue(
        cursorDataset(c),
        { kind: "schema", type: "array", expected: "Array", message },
        c.config,
      )
    }
  }
}

function compileString(schema: CompilableSchema): Step {
  const message = schema.message
  if (message === undefined) {
    return stringStep
  }
  return (c) => {
    if (typeof c.value === "string") {
      c.typed = true
    } else {
      _addIssue(
        cursorDataset(c),
        { kind: "schema", type: "string", expected: "string", message },
        c.config,
      )
    }
  }
}

function compileNumber(schema: CompilableSchema): Step {
  const message = schema.message
  if (message === undefined) {
    return numberStep
  }
  return (c) => {
    if (typeof c.value === "number" && !Number.isNaN(c.value)) {
      c.typed = true
    } else {
      _addIssue(
        cursorDataset(c),
        { kind: "schema", type: "number", expected: "number", message },
        c.config,
      )
    }
  }
}

function compileBoolean(schema: CompilableSchema): Step {
  const message = schema.message
  if (message === undefined) {
    return booleanStep
  }
  return (c) => {
    if (typeof c.value === "boolean") {
      c.typed = true
    } else {
      _addIssue(
        cursorDataset(c),
        { kind: "schema", type: "boolean", expected: "boolean", message },
        c.config,
      )
    }
  }
}

function compileOptional(schema: CompilableSchema): Step {
  const wrapped = schema.wrapped
  if (wrapped === undefined) {
    return compileFallback(schema)
  }
  const wrappedStep = getCompiledValidate(wrapped)
  const default_ = schema.default
  return (c) => {
    if (c.value === undefined) {
      c.typed = true
      c.value = typeof default_ === "function" ? (default_ as () => unknown)() : default_
      return
    }
    wrappedStep(c)
  }
}

function compileNullish(schema: CompilableSchema): Step {
  const wrapped = schema.wrapped
  if (wrapped === undefined) {
    return compileFallback(schema)
  }
  const wrappedStep = getCompiledValidate(wrapped)
  const default_ = schema.default
  return (c) => {
    if (c.value === null || c.value === undefined) {
      const input = c.value
      c.typed = true
      c.value =
        default_ === undefined
          ? input
          : typeof default_ === "function"
            ? (default_ as () => unknown)()
            : default_
      return
    }
    wrappedStep(c)
  }
}

function compileFallback(schema: CompilableSchema): Step {
  return (c) => {
    const dataset = schema["~run"]({ value: c.value }, c.config)
    c.value = dataset.value
    c.typed = dataset.typed
    if (dataset.issues !== undefined) {
      for (let i = 0; i < dataset.issues.length; i++) {
        c.issues.push(dataset.issues[i] as Issue)
      }
    }
  }
}

function stringStep(c: Cursor): void {
  if (typeof c.value === "string") {
    c.typed = true
  } else {
    _addIssue(
      cursorDataset(c),
      { kind: "schema", type: "string", expected: "string", message: undefined },
      c.config,
    )
  }
}

function numberStep(c: Cursor): void {
  if (typeof c.value === "number" && !Number.isNaN(c.value)) {
    c.typed = true
  } else {
    _addIssue(
      cursorDataset(c),
      { kind: "schema", type: "number", expected: "number", message: undefined },
      c.config,
    )
  }
}

function booleanStep(c: Cursor): void {
  if (typeof c.value === "boolean") {
    c.typed = true
  } else {
    _addIssue(
      cursorDataset(c),
      { kind: "schema", type: "boolean", expected: "boolean", message: undefined },
      c.config,
    )
  }
}

function prefixIssuePaths(issues: Issue[], start: number, key: PropertyKey): void {
  const head: IssuePathItem = { key }
  for (let i = start; i < issues.length; i++) {
    const issue = issues[i] as Issue
    ;(issue as { path?: readonly IssuePathItem[] }).path =
      issue.path === undefined ? [head] : [head, ...issue.path]
  }
}

function hasErrorIssueFrom(issues: readonly Issue[], start: number): boolean {
  for (let i = start; i < issues.length; i++) {
    if (!isWarningIssue(issues[i] as Issue)) {
      return true
    }
  }
  return false
}

function cursorDataset(c: Cursor): DatasetView {
  return c as unknown as DatasetView
}

function primitiveCode(schema: CompilableSchema): number {
  if ((schema as { readonly async: boolean }).async === true || schema.pipe !== undefined) {
    return 0
  }
  // Inline a bare-primitive `typeof` check ONLY for genuine native primitives, keyed on
  // factory identity — not on `schema.type`. A foreign child with `type: "string"` and a
  // stricter `~run` must NOT take the inline path (that would bypass its `~run`); returning 0
  // routes it to its compiled child Step, which falls back to `~run` (see `compile`).
  if (schema.reference === string) {
    return 1
  }
  if (schema.reference === number) {
    return 2
  }
  if (schema.reference === boolean) {
    return 3
  }
  return 0
}

function allPrimitiveCodes(codes: readonly number[]): boolean {
  for (let i = 0; i < codes.length; i++) {
    if ((codes[i] as number) === 0) {
      return false
    }
  }
  return true
}

function noProtoKeys(protoKeys: readonly boolean[]): boolean {
  for (let i = 0; i < protoKeys.length; i++) {
    if (protoKeys[i] as boolean) {
      return false
    }
  }
  return true
}

function addPrimitiveObjectIssue(
  c: Cursor,
  code: number,
  message: string | undefined,
  key: string,
  value: unknown,
): boolean {
  const mark = c.issues.length
  c.value = value
  c.typed = true
  if (code === 1) {
    _addIssue(
      cursorDataset(c),
      { kind: "schema", type: "string", expected: "string", message },
      c.config,
    )
  } else if (code === 2) {
    _addIssue(
      cursorDataset(c),
      { kind: "schema", type: "number", expected: "number", message },
      c.config,
    )
  } else {
    _addIssue(
      cursorDataset(c),
      { kind: "schema", type: "boolean", expected: "boolean", message },
      c.config,
    )
  }
  prefixIssuePaths(c.issues, mark, key)
  return isReject(c.config)
}
