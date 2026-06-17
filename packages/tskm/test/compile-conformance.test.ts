import { describe, expect, it } from "bun:test"
import { safeParseCompiled } from "../src/compile.ts"
import {
  array,
  type BaseSchema,
  boolean,
  type Config,
  nullish,
  number,
  object,
  optional,
  safeParse,
  string,
} from "../src/index.ts"
import type { OutputDataset } from "../src/types/dataset.ts"
import type { Issue } from "../src/types/issue.ts"
import { _addIssue } from "../src/utils/_addIssue.ts"

/**
 * The MUTATION ORACLE for `compile.ts`'s specialized walkers. `compile.test.ts` pins the
 * security-critical routing invariants; this file pins behavioral parity across EVERY
 * specialized path (the 3-/5-key strip unrolls, the general/wide primitive object, the
 * `array` item-inline codes for string/number/boolean and the object-element fallback, the
 * faithful-optional drop and defaults, the rest modes, `__proto__` handling, the abort knobs,
 * and the custom-message branches). Each case asserts the compiled result is byte-identical to
 * the interpreter (`toStrictEqual`), so ANY behavior-changing mutation in a covered path makes
 * the compiled output diverge from the (unmutated) interpreter and is killed. Stryker mutates
 * the whole package, so the interpreter is the differential oracle for the compiled walkers.
 */
function expectParity(schema: BaseSchema<unknown, unknown>, input: unknown, config?: Config): void {
  const interpreted = safeParse(schema, input, config)
  const compiled = safeParseCompiled(schema, input, config)
  expect(compiled).toStrictEqual(interpreted)
}

interface Fixture {
  readonly name: string
  readonly schema: BaseSchema<unknown, unknown>
  readonly input: unknown
  readonly config?: Config | undefined
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

/** A custom sync schema that succeeds with a warning-only issue (exercises `compileFallback`). */
function createWarningSchema(): BaseSchema<unknown, unknown> {
  const schema: BaseSchema<unknown, unknown> = {
    kind: "schema",
    type: "warning_custom",
    reference: createWarningSchema,
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
      return out as OutputDataset<unknown>
    },
  }
  return schema
}

function buildFixtures(): readonly Fixture[] {
  // Width sweep: 1..8 keys exercises both unrolled strip walkers (3, 5) and the general
  // primitive-object walker (the rest), each with a valid row, a fully-invalid row, and an
  // extra (stripped) key. Mixed string/number/boolean types pin each inline type code.
  const widthCases: Fixture[] = []
  for (let w = 1; w <= 8; w++) {
    const entries: Record<string, BaseSchema<unknown, unknown>> = {}
    const good: Record<string, unknown> = {}
    const bad: Record<string, unknown> = {}
    for (let i = 0; i < w; i++) {
      const kind = i % 3
      entries[`f${i}`] = kind === 0 ? string() : kind === 1 ? number() : boolean()
      good[`f${i}`] = kind === 0 ? `s${i}` : kind === 1 ? i : i % 2 === 0
      bad[`f${i}`] = kind === 0 ? i : kind === 1 ? `s${i}` : `notbool${i}`
    }
    const schema = object(entries)
    widthCases.push({ name: `width-${w}/valid`, schema, input: { ...good } })
    widthCases.push({ name: `width-${w}/invalid`, schema, input: { ...bad } })
    widthCases.push({ name: `width-${w}/extra-key`, schema, input: { ...good, zEXTRA: 1 } })
  }

  // wide-24: the general primitive-object walker beyond the unroll thresholds.
  const wideEntries: Record<string, BaseSchema<unknown, unknown>> = {}
  const wideGood: Record<string, unknown> = {}
  const wideBad: Record<string, unknown> = {}
  for (let i = 0; i < 24; i++) {
    wideEntries[`k${i}`] = i % 2 === 0 ? string() : number()
    wideGood[`k${i}`] = i % 2 === 0 ? `v${i}` : i
    wideBad[`k${i}`] = i % 2 === 0 ? i : `v${i}`
  }
  const wide = object(wideEntries)

  // Arrays: item codes 1/2/3 (string/number/boolean inline) AND the object-element fallback.
  const strArr = array(string())
  const numArr = array(number())
  const boolArr = array(boolean())
  const objArr = array(object({ x: number(), y: number(), label: string() }))
  const objArrData = Array.from({ length: 6 }, (_, i) => ({ x: i, y: i * 2, label: `pt${i}` }))

  // Nested: object-in-object, array child, optional + nullish children, deep error paths.
  const nested = object({
    user: object({
      id: string(),
      profile: object({ name: string(), bio: optional(string()), tags: array(string()) }),
    }),
    posts: array(object({ title: string(), views: number(), published: boolean() })),
    meta: nullish(object({ version: number() })),
  })
  const nestedGood = {
    user: { id: "u", profile: { name: "g", bio: "h", tags: ["a", "b"] } },
    posts: [{ title: "p", views: 1, published: true }],
    meta: { version: 2 },
  }
  const nestedBad = {
    user: { id: 5, profile: { name: 6, tags: [1, 2] } },
    posts: [{ title: 7, views: "x", published: "yes" }],
    meta: { version: "bad" },
  }

  // faithful-optional drop + static/lazy defaults.
  const faithful = object({ name: string(), bio: optional(string()) }, { optionalKeys: true })
  const withDefault = object({ bio: optional(string(), "fallback") }, { optionalKeys: true })
  const withLazy = object({ bio: optional(string(), () => "lazy") }, { optionalKeys: true })
  const withNullish = object({ tag: nullish(number()) }, { optionalKeys: true })

  // rest modes (strip/exact/passthrough) with an extra key and with an own-`__proto__` key.
  const restStrip = object({ known: string() }, { rest: "strip" })
  const restExact = object({ known: string() }, { rest: "exact" })
  const restPass = object({ known: string() }, { rest: "passthrough" })

  // declared `__proto__` entry: the `_safeAssign` / protoKeys path.
  const protoEntries: Record<string, BaseSchema<unknown, unknown>> = {}
  Object.defineProperty(protoEntries, "__proto__", {
    value: string(),
    enumerable: true,
    configurable: true,
    writable: true,
  })
  const protoObject = object(protoEntries)

  // abort knobs over a multi-error nested payload.
  const rejectSchema = object({
    user: object({ name: string(), tags: array(string()) }),
    count: number(),
  })
  const rejectInput = { user: { name: 123, tags: ["ok", 7] }, count: "bad" }

  // custom messages: compileString/Number/Boolean message branch + childMessages + itemMessage.
  const msgString = string("must be string")
  const msgChildObject = object({ a: string("a msg"), b: number("b msg"), c: boolean("c msg") })
  const msgArray = array(number("elem msg"))

  return [
    // primitives (bare leaf fast paths + their invalids, incl. NaN rejection)
    { name: "prim/string-ok", schema: string(), input: "hi" },
    { name: "prim/string-bad", schema: string(), input: 123 },
    { name: "prim/number-ok", schema: number(), input: 42 },
    { name: "prim/number-bad-string", schema: number(), input: "42" },
    { name: "prim/number-bad-nan", schema: number(), input: Number.NaN },
    { name: "prim/boolean-ok", schema: boolean(), input: true },
    { name: "prim/boolean-bad", schema: boolean(), input: "true" },
    ...widthCases,
    { name: "wide-24/valid", schema: wide, input: { ...wideGood } },
    { name: "wide-24/invalid", schema: wide, input: { ...wideBad } },
    // arrays
    { name: "array/string-ok", schema: strArr, input: ["a", "b", "c"] },
    { name: "array/string-bad", schema: strArr, input: ["a", 2, "c"] },
    { name: "array/string-not-array", schema: strArr, input: "nope" },
    { name: "array/number-ok", schema: numArr, input: [0, 1, 2, 3] },
    { name: "array/number-bad", schema: numArr, input: [0, 1, "x", 3] },
    { name: "array/boolean-ok", schema: boolArr, input: [true, false] },
    { name: "array/boolean-bad", schema: boolArr, input: [true, 0] },
    { name: "array/object-ok", schema: objArr, input: objArrData },
    {
      name: "array/object-bad",
      schema: objArr,
      input: [
        { x: 0, y: 0, label: "p" },
        { x: "bad", y: 2, label: 3 },
      ],
    },
    // nested
    { name: "nested/valid", schema: nested, input: nestedGood },
    { name: "nested/invalid", schema: nested, input: nestedBad },
    // faithful-optional
    { name: "opt/missing", schema: faithful, input: { name: "ada" } },
    { name: "opt/undefined", schema: faithful, input: { name: "ada", bio: undefined } },
    { name: "opt/present", schema: faithful, input: { name: "ada", bio: "x" } },
    { name: "opt/default", schema: withDefault, input: {} },
    { name: "opt/lazy-default", schema: withLazy, input: {} },
    { name: "opt/nullish-missing", schema: withNullish, input: {} },
    { name: "opt/nullish-null", schema: withNullish, input: { tag: null } },
    { name: "opt/nullish-present", schema: withNullish, input: { tag: 7 } },
    // rest modes
    { name: "rest/strip-extra", schema: restStrip, input: { known: "ok", extra: 1 } },
    { name: "rest/exact-extra", schema: restExact, input: { known: "ok", extra: 1 } },
    { name: "rest/passthrough-extra", schema: restPass, input: { known: "ok", extra: 1 } },
    { name: "rest/strip-proto", schema: restStrip, input: withOwnProto({ known: "ok" }, 1) },
    { name: "rest/exact-proto", schema: restExact, input: withOwnProto({ known: "ok" }, 1) },
    { name: "rest/passthrough-proto", schema: restPass, input: withOwnProto({ known: "ok" }, 1) },
    // declared proto
    { name: "proto/declared", schema: protoObject, input: withOwnProto({}, "safe") },
    // abort knobs
    { name: "abort/default", schema: rejectSchema, input: rejectInput },
    { name: "abort/early", schema: rejectSchema, input: rejectInput, config: { abortEarly: true } },
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
    // custom messages
    { name: "msg/string-bad", schema: msgString, input: 1 },
    { name: "msg/child-object-bad", schema: msgChildObject, input: { a: 1, b: "x", c: "y" } },
    { name: "msg/array-elem-bad", schema: msgArray, input: [1, "x", 3] },
    // fallback warning-only
    { name: "fallback/warning", schema: createWarningSchema(), input: "warn" },
  ]
}

describe("safeParseCompiled — full interpreter-parity battery (compile.ts mutation oracle)", () => {
  for (const fixture of buildFixtures()) {
    it(`byte-identical to the interpreter: ${fixture.name}`, () => {
      expectParity(fixture.schema, fixture.input, fixture.config)
    })
  }
})

describe("safeParseCompiled — custom-message issue parity (message branches)", () => {
  it("primitive custom message surfaces verbatim, identical to the interpreter", () => {
    const schema = string("must be string")
    const compiled = safeParseCompiled(schema, 1)
    expect(compiled.success).toBe(false)
    expect(compiled.issues?.[0]?.message).toBe("must be string")
    expectParity(schema, 1)
  })

  it("object child custom messages surface per failing field", () => {
    const schema = object({ a: string("a msg"), b: number("b msg") })
    const compiled = safeParseCompiled(schema, { a: 1, b: "x" })
    const messages = (compiled.issues ?? []).map((i) => i.message).sort()
    expect(messages).toEqual(["a msg", "b msg"])
    expectParity(schema, { a: 1, b: "x" })
  })

  it("array element custom message surfaces with the element path", () => {
    const schema = array(number("elem msg"))
    const compiled = safeParseCompiled(schema, [1, "x"])
    expect(compiled.issues?.[0]?.message).toBe("elem msg")
    expect(compiled.issues?.[0]?.path?.[0]).toStrictEqual({ key: 1 })
    expectParity(schema, [1, "x"])
  })

  it("bare number/boolean custom messages (compileNumber/compileBoolean message branch)", () => {
    expectParity(number("num msg"), "x")
    expectParity(boolean("bool msg"), 1)
    expect(safeParseCompiled(number("num msg"), "x").issues?.[0]?.message).toBe("num msg")
    expect(safeParseCompiled(boolean("bool msg"), 1).issues?.[0]?.message).toBe("bool msg")
    expectParity(string("str msg"), 1)
  })
})

/**
 * Branch-targeting battery: the abort early-returns inside the primitive-object walkers (a bad
 * field under `mode:"reject"` / `abortEarly`), the non-object `else` branches of those walkers
 * (null/string/array input), the array abort branch, and the optional/nullish wrapped-invalid
 * paths. These are the parts the happy-path parity cases above never execute.
 */
function buildBranchFixtures(): readonly Fixture[] {
  const o3 = object({ a: string(), b: number(), c: boolean() }) // 3-key strip unroll
  const o5 = object({ a: string(), b: number(), c: boolean(), d: string(), e: number() }) // 5-key
  const gen = object({ a: string(), b: number(), c: boolean(), d: string() }) // general (4-key)
  const bad3 = { a: 1, b: "x", c: 9 }
  const bad5 = { a: 1, b: "x", c: 9, d: 2, e: "y" }
  const bad4 = { a: 1, b: "x", c: 9, d: 2 }
  const numArr = array(number())
  const optObj = object({ bio: optional(string()) }, { optionalKeys: true })
  const nulObj = object({ tag: nullish(number()) }, { optionalKeys: true })
  // Type-ORDER permutations: the unrolled walkers inline `c===1?string:c===2?number:boolean`
  // per slot, so the inner ternary branches only run when a slot's type is number/boolean. The
  // happy-path width sweep fixes slot0=string; these put number/boolean first so every branch of
  // every slot's typeof ternary executes (valid row exercises the true branch, bad row the false).
  const num3 = object({ a: number(), b: boolean(), c: string() })
  const bool3 = object({ a: boolean(), b: string(), c: number() })
  const num5 = object({ a: number(), b: boolean(), c: string(), d: number(), e: boolean() })
  const bool5 = object({ a: boolean(), b: string(), c: number(), d: boolean(), e: string() })
  return [
    // type-order permutations (kill the per-slot typeof-ternary branches)
    { name: "num3/valid", schema: num3, input: { a: 1, b: true, c: "s" } },
    { name: "num3/bad", schema: num3, input: { a: "x", b: 1, c: 2 } },
    { name: "bool3/valid", schema: bool3, input: { a: true, b: "s", c: 1 } },
    { name: "bool3/bad", schema: bool3, input: { a: 1, b: 2, c: "x" } },
    { name: "num5/valid", schema: num5, input: { a: 1, b: true, c: "s", d: 2, e: false } },
    { name: "num5/bad", schema: num5, input: { a: "x", b: 1, c: 2, d: "y", e: 3 } },
    { name: "bool5/valid", schema: bool5, input: { a: true, b: "s", c: 1, d: false, e: "t" } },
    { name: "bool5/bad", schema: bool5, input: { a: 1, b: 2, c: "x", d: 3, e: 4 } },
    // primitive-object abort early-returns (first bad field aborts under reject/abortEarly)
    { name: "strip3/report-bad", schema: o3, input: bad3 },
    { name: "strip3/reject-bad", schema: o3, input: bad3, config: { mode: "reject" } },
    { name: "strip3/abortEarly-bad", schema: o3, input: bad3, config: { abortEarly: true } },
    { name: "strip5/report-bad", schema: o5, input: bad5 },
    { name: "strip5/reject-bad", schema: o5, input: bad5, config: { mode: "reject" } },
    { name: "strip5/abortEarly-bad", schema: o5, input: bad5, config: { abortEarly: true } },
    // abort at a SPECIFIC field position (earlier fields valid) — pins each per-slot early-return
    {
      name: "strip3/reject-at1",
      schema: o3,
      input: { a: "s", b: "x", c: true },
      config: { mode: "reject" },
    },
    {
      name: "strip3/reject-at2",
      schema: o3,
      input: { a: "s", b: 1, c: "x" },
      config: { mode: "reject" },
    },
    {
      name: "strip5/reject-at1",
      schema: o5,
      input: { a: "s", b: "x", c: true, d: "s", e: 1 },
      config: { mode: "reject" },
    },
    {
      name: "strip5/reject-at2",
      schema: o5,
      input: { a: "s", b: 1, c: "x", d: "s", e: 1 },
      config: { mode: "reject" },
    },
    {
      name: "strip5/reject-at3",
      schema: o5,
      input: { a: "s", b: 1, c: true, d: 5, e: 1 },
      config: { mode: "reject" },
    },
    {
      name: "strip5/reject-at4",
      schema: o5,
      input: { a: "s", b: 1, c: true, d: "s", e: "x" },
      config: { mode: "reject" },
    },
    { name: "gen/report-bad", schema: gen, input: bad4 },
    { name: "gen/reject-bad", schema: gen, input: bad4, config: { mode: "reject" } },
    { name: "gen/abortEarly-bad", schema: gen, input: bad4, config: { abortEarly: true } },
    // non-object inputs to the primitive-object walkers (the `else` branch)
    { name: "strip3/null", schema: o3, input: null },
    { name: "strip3/string", schema: o3, input: "x" },
    { name: "strip3/array", schema: o3, input: [1, 2, 3] },
    { name: "strip5/null", schema: o5, input: null },
    { name: "strip5/number", schema: o5, input: 42 },
    { name: "gen/null", schema: gen, input: null },
    { name: "gen/array", schema: gen, input: [] },
    // array abort branch + non-array
    { name: "array/reject-bad", schema: numArr, input: [1, "x", 3], config: { mode: "reject" } },
    {
      name: "array/abortEarly-bad",
      schema: numArr,
      input: [1, "x", 3],
      config: { abortEarly: true },
    },
    { name: "array/not-array", schema: numArr, input: { length: 2 } },
    // optional / nullish wrapped-invalid + present
    { name: "opt/wrapped-bad", schema: optObj, input: { bio: 1 } },
    { name: "opt/wrapped-present", schema: optObj, input: { bio: "ok" } },
    { name: "nullish/wrapped-bad", schema: nulObj, input: { tag: "x" } },
    { name: "nullish/wrapped-present", schema: nulObj, input: { tag: 5 } },
    { name: "nullish/wrapped-null", schema: nulObj, input: { tag: null } },
  ]
}

describe("safeParseCompiled — branch parity (abort / non-object / wrapped-invalid paths)", () => {
  for (const fixture of buildBranchFixtures()) {
    it(`byte-identical to the interpreter: ${fixture.name}`, () => {
      expectParity(fixture.schema, fixture.input, fixture.config)
    })
  }
})
