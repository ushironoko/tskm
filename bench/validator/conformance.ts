globalThis.Bun ??= { nanoseconds: () => Number(process.hrtime.bigint()) } as any

import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { inspect } from "node:util"
import { safeParseCompiled } from "../../packages/tskm/src/compile.ts"
import {
  array,
  type BaseSchema,
  boolean,
  nullish,
  number,
  object,
  optional,
  safeParse,
  string,
} from "../../packages/tskm/src/index.ts"
import type { Config } from "../../packages/tskm/src/types/config.ts"
import type { Issue } from "../../packages/tskm/src/types/issue.ts"
import { _addIssue } from "../../packages/tskm/src/utils/_addIssue.ts"

interface ValidatorFixture {
  readonly name: string
  readonly schema: BaseSchema<unknown, unknown>
  readonly input: unknown
  readonly config?: Config | undefined
}

interface ConformanceCase extends ValidatorFixture {}

export interface ConformanceSummary {
  readonly casesChecked: number
  readonly passed: true
}

const issueKeys = ["kind", "type", "expected", "received", "message", "input", "path", "severity"]

export function createBenchmarkFixtures(): readonly ValidatorFixture[] {
  const stringSchema = string()
  const numberSchema = number()
  const booleanSchema = boolean()

  const flatObject = object({
    id: string(),
    age: number(),
    active: boolean(),
    score: number(),
    name: string(),
  })
  const flatObjectData = { id: "u_1", age: 30, active: true, score: 9.5, name: "ada" }

  const wideEntries: Record<string, BaseSchema<unknown, unknown>> = {}
  const wideData: Record<string, unknown> = {}
  for (let i = 0; i < 24; i++) {
    wideEntries[`k${i}`] = i % 2 === 0 ? string() : number()
    wideData[`k${i}`] = i % 2 === 0 ? `v${i}` : i
  }
  const wideObject = object(wideEntries)

  const nestedObject = object({
    user: object({
      id: string(),
      profile: object({
        name: string(),
        bio: optional(string()),
        tags: array(string()),
      }),
    }),
    posts: array(
      object({
        title: string(),
        views: number(),
        published: boolean(),
      }),
    ),
    meta: nullish(object({ version: number() })),
  })
  const nestedData = {
    user: {
      id: "u_42",
      profile: { name: "grace", bio: "hopper", tags: ["a", "b", "c"] },
    },
    posts: [
      { title: "p1", views: 10, published: true },
      { title: "p2", views: 20, published: false },
      { title: "p3", views: 30, published: true },
    ],
    meta: { version: 2 },
  }

  const numberArray = array(number())
  const numberArrayData = Array.from({ length: 100 }, (_, i) => i)

  const objectArray = array(object({ x: number(), y: number(), label: string() }))
  const objectArrayData = Array.from({ length: 50 }, (_, i) => ({
    x: i,
    y: i * 2,
    label: `pt${i}`,
  }))

  const flatObjectBadData = { id: 1, age: "x", active: "no", score: null, name: 2 }
  const nestedBadData = {
    user: { id: 5, profile: { name: 6, tags: [1, 2] } },
    posts: [{ title: 7, views: "x", published: "yes" }],
    meta: { version: "bad" },
  }

  return [
    { name: "primitive/string", schema: stringSchema, input: "hello world" },
    { name: "primitive/number", schema: numberSchema, input: 42 },
    { name: "primitive/boolean", schema: booleanSchema, input: true },
    { name: "object/flat", schema: flatObject, input: flatObjectData },
    { name: "object/wide-24", schema: wideObject, input: wideData },
    { name: "object/nested", schema: nestedObject, input: nestedData },
    { name: "array/number-100", schema: numberArray, input: numberArrayData },
    { name: "array/object-50", schema: objectArray, input: objectArrayData },
    { name: "error/object-flat", schema: flatObject, input: flatObjectBadData },
    { name: "error/object-nested", schema: nestedObject, input: nestedBadData },
  ]
}

export function runConformance(): ConformanceSummary {
  const cases = createConformanceCases()
  for (const testCase of cases) {
    const interpreted = safeParse(testCase.schema, testCase.input, testCase.config)
    const compiled = safeParseCompiled(testCase.schema, testCase.input, testCase.config)
    assertResultsEqual(testCase.name, interpreted, compiled)
  }
  return { casesChecked: cases.length, passed: true }
}

function createConformanceCases(): readonly ConformanceCase[] {
  const benchmarkCases = createBenchmarkFixtures()
  const primitiveCases: ConformanceCase[] = [
    { name: "primitive/string-invalid", schema: string(), input: 123 },
    { name: "primitive/number-invalid-string", schema: number(), input: "42" },
    { name: "primitive/number-invalid-nan", schema: number(), input: Number.NaN },
    { name: "primitive/boolean-invalid", schema: boolean(), input: "true" },
  ]

  const wideBadEntries: Record<string, BaseSchema<unknown, unknown>> = {}
  const wideBadData: Record<string, unknown> = {}
  for (let i = 0; i < 24; i++) {
    wideBadEntries[`k${i}`] = i % 2 === 0 ? string() : number()
    wideBadData[`k${i}`] = i % 2 === 0 ? i : `v${i}`
  }

  const arrayBadCases: ConformanceCase[] = [
    { name: "array/number-100-invalid", schema: array(number()), input: [0, 1, "x", 3] },
    {
      name: "array/object-50-invalid",
      schema: array(object({ x: number(), y: number(), label: string() })),
      input: [
        { x: 0, y: 0, label: "pt0" },
        { x: "bad", y: 2, label: 3 },
      ],
    },
    { name: "object/wide-24-invalid", schema: object(wideBadEntries), input: wideBadData },
  ]

  const faithfulOptional = object(
    {
      name: string(),
      bio: optional(string()),
    },
    { optionalKeys: true },
  )
  const optionalDefault = object(
    {
      bio: optional(string(), "fallback"),
    },
    { optionalKeys: true },
  )
  const optionalLazyDefault = object(
    {
      bio: optional(string(), () => "lazy-fallback"),
    },
    { optionalKeys: true },
  )
  const faithfulOptionalCases: ConformanceCase[] = [
    { name: "faithful-optional/missing", schema: faithfulOptional, input: { name: "ada" } },
    {
      name: "faithful-optional/undefined",
      schema: faithfulOptional,
      input: { name: "ada", bio: undefined },
    },
    {
      name: "faithful-optional/present",
      schema: faithfulOptional,
      input: { name: "ada", bio: "x" },
    },
    { name: "faithful-optional/default", schema: optionalDefault, input: {} },
    { name: "faithful-optional/lazy-default", schema: optionalLazyDefault, input: {} },
  ]

  const restSchemaStrip = object({ known: string() }, { rest: "strip" })
  const restSchemaExact = object({ known: string() }, { rest: "exact" })
  const restSchemaPassthrough = object({ known: string() }, { rest: "passthrough" })
  const restCases: ConformanceCase[] = [
    { name: "rest/strip-extra", schema: restSchemaStrip, input: { known: "ok", extra: 1 } },
    { name: "rest/exact-extra", schema: restSchemaExact, input: { known: "ok", extra: 1 } },
    {
      name: "rest/passthrough-extra",
      schema: restSchemaPassthrough,
      input: { known: "ok", extra: 1 },
    },
    { name: "rest/strip-proto", schema: restSchemaStrip, input: withOwnProto({ known: "ok" }, 1) },
    { name: "rest/exact-proto", schema: restSchemaExact, input: withOwnProto({ known: "ok" }, 1) },
    {
      name: "rest/passthrough-proto",
      schema: restSchemaPassthrough,
      input: withOwnProto({ known: "ok" }, 1),
    },
  ]

  const protoEntries: Record<string, BaseSchema<unknown, unknown>> = {}
  Object.defineProperty(protoEntries, "__proto__", {
    value: string(),
    enumerable: true,
    configurable: true,
    writable: true,
  })
  const protoDeclaredCases: ConformanceCase[] = [
    {
      name: "object/declared-proto",
      schema: object(protoEntries),
      input: withOwnProto({}, "safe"),
    },
  ]

  const rejectSchema = object({
    user: object({
      name: string(),
      tags: array(string()),
    }),
    count: number(),
  })
  const rejectInput = { user: { name: 123, tags: ["ok", 7] }, count: "bad" }
  const abortCases: ConformanceCase[] = [
    { name: "abort/default-report", schema: rejectSchema, input: rejectInput },
    {
      name: "abort/abortEarly-true",
      schema: rejectSchema,
      input: rejectInput,
      config: { abortEarly: true },
    },
    {
      name: "abort/mode-reject",
      schema: rejectSchema,
      input: rejectInput,
      config: { mode: "reject" },
    },
    {
      name: "abort/mode-report",
      schema: rejectSchema,
      input: rejectInput,
      config: { mode: "report" },
    },
  ]

  const warningSchema = createWarningSchema()
  const fallbackCases: ConformanceCase[] = [
    { name: "fallback/warning-success", schema: warningSchema, input: "warn" },
  ]

  return [
    ...benchmarkCases,
    ...primitiveCases,
    ...arrayBadCases,
    ...faithfulOptionalCases,
    ...restCases,
    ...protoDeclaredCases,
    ...abortCases,
    ...fallbackCases,
  ]
}

function withOwnProto(base: Record<string, unknown>, value: unknown): Record<string, unknown> {
  Object.defineProperty(base, "__proto__", {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return base
}

function createWarningSchema(): BaseSchema<unknown, unknown> {
  return {
    kind: "schema",
    type: "warning_custom",
    reference: createWarningSchema as never,
    expects: "unknown",
    async: false,
    get "~standard"(): never {
      throw new Error("not used")
    },
    "~run"(dataset, config) {
      const out = dataset as { typed?: boolean; value: unknown; issues?: Issue[] }
      out.typed = true
      _addIssue(
        dataset,
        {
          kind: "validation",
          type: "warning_custom",
          expected: null,
          message: "warning only",
          severity: "warning",
        },
        config,
      )
      return out as never
    },
  }
}

function assertResultsEqual(name: string, interpreted: unknown, compiled: unknown): void {
  const diff = diffValue(interpreted, compiled, "$")
  if (diff !== undefined) {
    throw new Error(`conformance mismatch in ${name}\n${diff}`)
  }
}

function diffValue(left: unknown, right: unknown, path: string): string | undefined {
  if (Object.is(left, right)) {
    return undefined
  }
  if (isIssue(left) && isIssue(right)) {
    return diffIssue(left, right, path)
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return formatDiff(path, left, right)
    }
    if (left.length !== right.length) {
      return formatDiff(`${path}.length`, left.length, right.length)
    }
    for (let i = 0; i < left.length; i++) {
      const diff = diffValue(left[i], right[i], `${path}[${i}]`)
      if (diff !== undefined) {
        return diff
      }
    }
    return undefined
  }
  if (isComparableObject(left) || isComparableObject(right)) {
    if (!isComparableObject(left) || !isComparableObject(right)) {
      return formatDiff(path, left, right)
    }
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    const keyDiff = diffValue(leftKeys, rightKeys, `${path}{keys}`)
    if (keyDiff !== undefined) {
      return keyDiff
    }
    for (const key of leftKeys) {
      if (!Object.hasOwn(right, key)) {
        return formatDiff(`${path}.${key}{presence}`, true, false)
      }
      const diff = diffValue(left[key], right[key], `${path}.${key}`)
      if (diff !== undefined) {
        return diff
      }
    }
    return undefined
  }
  return formatDiff(path, left, right)
}

function diffIssue(left: Issue, right: Issue, path: string): string | undefined {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  const keysDiff = diffValue(leftKeys, rightKeys, `${path}{issueKeys}`)
  if (keysDiff !== undefined) {
    return keysDiff
  }
  for (const key of issueKeys) {
    const diff = diffValue(left[key as keyof Issue], right[key as keyof Issue], `${path}.${key}`)
    if (diff !== undefined) {
      return diff
    }
  }
  return undefined
}

function isIssue(value: unknown): value is Issue {
  return (
    isComparableObject(value) &&
    Object.hasOwn(value, "kind") &&
    Object.hasOwn(value, "type") &&
    Object.hasOwn(value, "expected") &&
    Object.hasOwn(value, "received") &&
    Object.hasOwn(value, "message")
  )
}

function isComparableObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

function formatDiff(path: string, interpreted: unknown, compiled: unknown): string {
  return `${path}\n  interpreted: ${inspect(interpreted, { depth: 12, sorted: false })}\n  compiled:    ${inspect(compiled, { depth: 12, sorted: false })}`
}

function isDirectRun(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href
}

if (isDirectRun()) {
  try {
    const summary = runConformance()
    console.log(`PASS casesChecked=${summary.casesChecked}`)
  } catch (error) {
    console.error("FAIL")
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  }
}
