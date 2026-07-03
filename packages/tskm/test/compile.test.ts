import { describe, expect, it } from "bun:test"
import { safeParseCompiled } from "../src/compile.ts"
import {
  array,
  type BaseSchema,
  boolean,
  type Config,
  check,
  minLength,
  minValue,
  nullish,
  number,
  object,
  optional,
  pipe,
  safeParse,
  string,
  type TransformContext,
  transform,
  union,
} from "../src/index.ts"
import type { OutputDataset } from "../src/types/dataset.ts"
import type { Issue } from "../src/types/issue.ts"

/**
 * STRYKER ORACLE (wiring deferred). This battery is the mutation oracle for `compile.ts`.
 * It already KILLS the mutants that matter: verified manually that replacing the `.pipe`
 * fallback guard in `compile()` with `false` (which would reintroduce the disqualified PoC's
 * validation bypass) fails 6 cases here. When Stryker lands on `main` (it currently lives on
 * the unmerged `test/stryker-mutation` branch, so its config is not touched here), wire it as:
 *   1. add `packages/tskm/src/compile.ts` to Stryker's `mutate` targets;
 *   2. require this file to KILL every mutant on these survival-critical sites: the `.pipe` /
 *      `async` fallback guard, the `schema.reference` factory-identity dispatch in `compile()`
 *      AND the reference-identity branches in `primitiveCode()` (mutating either back to a
 *      `.type`-string check reintroduces the type-collision bypass — see the collision battery
 *      below), each primitive inline fast-path branch, the `prefixIssuePaths` index range, the
 *      faithful-optional drop condition, and the `hasErrorIssueFrom`/`isReject` abort condition;
 *   3. a surviving mutant on any of those is a release blocker.
 *
 * The compiled fast path MUST be byte-identical to the interpreter on success AND error
 * paths. `toStrictEqual` distinguishes a missing key from an `undefined` key (the
 * faithful-optional contract) and compares every issue field, so it is the right byte-for-
 * byte oracle. Every case here also exists to lock in the routing the disqualified PoC
 * implementation got wrong: a piped/refined/transformed child inside a container must run
 * its full pipe (via the fallback to `~run`), never be short-circuited by a bare-leaf fast
 * path keyed only on the child's `.type`.
 */
function expectParity(schema: BaseSchema<unknown, unknown>, input: unknown, config?: Config): void {
  const interpreted = safeParse(schema, input, config)
  const compiled = safeParseCompiled(schema, input, config)
  expect(compiled).toStrictEqual(interpreted)
}

describe("safeParseCompiled — interpreter parity (byte-identical)", () => {
  it("flat object: valid and invalid", () => {
    const schema = object({ id: string(), age: number(), active: boolean() })
    expectParity(schema, { id: "u1", age: 30, active: true })
    expectParity(schema, { id: 1, age: "x", active: "no" })
    expectParity(schema, null)
  })

  it("array of objects: valid and invalid", () => {
    const schema = array(object({ x: number(), label: string() }))
    expectParity(schema, [
      { x: 0, label: "a" },
      { x: 1, label: "b" },
    ])
    expectParity(schema, [{ x: "bad", label: 2 }])
    expectParity(schema, "not-an-array")
  })

  it("nested containers with optional and array leaves", () => {
    const schema = object({
      user: object({ id: string(), tags: array(string()) }),
      bio: optional(string()),
    })
    expectParity(schema, { user: { id: "u", tags: ["a", "b"] }, bio: "hi" })
    expectParity(schema, { user: { id: 1, tags: [2] } })
  })

  it("faithful-optional: missing vs undefined vs present vs default", () => {
    const schema = object({ name: string(), bio: optional(string()) }, { optionalKeys: true })
    expectParity(schema, { name: "ada" })
    expectParity(schema, { name: "ada", bio: undefined })
    expectParity(schema, { name: "ada", bio: "x" })
    const withDefault = object({ bio: optional(string(), "fallback") }, { optionalKeys: true })
    expectParity(withDefault, {})
  })

  it("rest modes: strip / exact / passthrough", () => {
    expectParity(object({ k: string() }, { rest: "strip" }), { k: "ok", extra: 1 })
    expectParity(object({ k: string() }, { rest: "exact" }), { k: "ok", extra: 1 })
    expectParity(object({ k: string() }, { rest: "passthrough" }), { k: "ok", extra: 1 })
  })

  it("abort knobs: default report vs abortEarly", () => {
    const schema = object({ a: object({ n: number() }), b: number() })
    const bad = { a: { n: "x" }, b: "y" }
    expectParity(schema, bad)
    expectParity(schema, bad, { abortEarly: true })
  })
})

describe("safeParseCompiled — piped/refined child in a container (the PoC bypass class)", () => {
  it("piped-primitive-in-object: a failing refinement is NOT bypassed", () => {
    const schema = object({
      a: pipe(
        string(),
        check((s: string) => s.length > 3, "too short"),
      ),
    })
    // The interpreter rejects "ab" (check fails). The compiled path MUST agree — the
    // disqualified PoC accepted it as valid, dropping the issue (a validation bypass).
    const compiled = safeParseCompiled(schema, { a: "ab" })
    expect(compiled.success).toBe(false)
    expect(compiled.issues?.some((i) => i.message === "too short")).toBe(true)
    expectParity(schema, { a: "ab" })
    expectParity(schema, { a: "abcd" })
  })

  it("piped-primitive-in-array: a failing refinement is NOT bypassed", () => {
    const schema = array(pipe(number(), minValue(10)))
    const compiled = safeParseCompiled(schema, [5])
    expect(compiled.success).toBe(false)
    expectParity(schema, [5])
    expectParity(schema, [12, 99])
  })

  it("transform-in-container: the transform output is applied, not dropped", () => {
    const schema = object({
      a: pipe(
        string(),
        transform((s: string) => s.toUpperCase()),
      ),
    })
    const compiled = safeParseCompiled(schema, { a: "ok" })
    expect(compiled.success).toBe(true)
    expect((compiled.output as { a: string }).a).toBe("OK")
    expectParity(schema, { a: "ok" })
  })

  it("warning-only pipe in a container: success with warnings, identical to interpreter", () => {
    const warn = pipe(
      string(),
      transform((v: string, ctx: TransformContext) => {
        ctx.issue("heads up", "warning")
        return v
      }),
    )
    const schema = object({ a: warn })
    const compiled = safeParseCompiled(schema, { a: "ok" })
    expect(compiled.success).toBe(true)
    expect(compiled.warnings.length).toBe(1)
    expectParity(schema, { a: "ok" })
  })

  it("failing-sibling-then-piped-sibling under abortPipeEarly", () => {
    const schema = object({
      a: pipe(number(), minValue(10)),
      b: pipe(string(), minLength(3)),
    })
    const bad = { a: 5, b: "x" }
    expectParity(schema, bad, { abortPipeEarly: true })
    expectParity(schema, bad)
  })
})

describe("safeParseCompiled — delegation fidelity (coverage holes)", () => {
  it("a non-specialized kind (union) falls back to `~run` identically", () => {
    // union is not specialized by the compiler, so it must route through the fallback Step
    // (which calls the interpreter `~run`) and stay byte-identical, nested in a container too.
    const schema = object({ v: union([string(), number()]) })
    expectParity(schema, { v: "s" })
    expectParity(schema, { v: 7 })
    expectParity(schema, { v: true })
  })

  it("a custom this-bound schema preserves `this` via the fallback", () => {
    // A custom sync schema whose `~run` reads `this`. The compiled fallback invokes it as
    // `schema["~run"](...)`, so `this === schema`; a detached call would lose `this.expects`.
    const schema = object({ a: thisProbe() })
    expectParity(schema, { a: "ok" })
    expectParity(schema, { a: 123 })
  })
})

describe("safeParseCompiled — fast-path-only-for-bare-leaf invariant", () => {
  it("a bare primitive child uses the inline fast path AND a piped sibling is fully run", () => {
    // bare `id` exercises the inlined leaf fast path; piped `code` MUST still run its check.
    // This is the exact shape that separates a correct router from the bypass: same object,
    // one bare leaf + one piped leaf.
    const schema = object({
      id: string(),
      code: pipe(
        string(),
        check((s: string) => s.startsWith("x"), "must start with x"),
      ),
    })
    expectParity(schema, { id: "u", code: "xyz" })
    const bad = safeParseCompiled(schema, { id: "u", code: "abc" })
    expect(bad.success).toBe(false)
    expect(bad.issues?.some((i) => i.message === "must start with x")).toBe(true)
    expectParity(schema, { id: 1, code: "xyz" })
  })
})

/**
 * Type-string collision battery (the router-bypass regression). `BaseSchema.type` is a public
 * structural string, so a FOREIGN schema can carry a built-in `type` (e.g. "string") with a
 * stricter `~run`. The disqualified router specialized on that string and silently bypassed the
 * foreign `~run`, accepting input the interpreter rejects. The compiler must specialize ONLY
 * genuine native factory outputs (keyed on `schema.reference` identity) and fall back to `~run`
 * for everything else. Each case here uses an input the matching BUILT-IN fast path would
 * ACCEPT while the probe's `~run` REJECTS, so it fails against the old `.type` router and passes
 * once dispatch is narrowed to factory identity.
 */
describe("safeParseCompiled — specializes only native factory outputs (type-string collision)", () => {
  // One case per top-level type `compile()` specializes. `structural` supplies the field each
  // `compileX` requires before it specializes (`entries`/`item`/`wrapped`); `input` is a value
  // the genuine built-in would accept.
  const cases: ReadonlyArray<{
    readonly type: string
    readonly structural: ProbeStructural
    readonly input: unknown
  }> = [
    { type: "string", structural: {}, input: "ok" },
    { type: "number", structural: {}, input: 42 },
    { type: "boolean", structural: {}, input: true },
    { type: "object", structural: { entries: {} }, input: {} },
    { type: "array", structural: { item: string() }, input: [] },
    { type: "optional", structural: { wrapped: string() }, input: undefined },
    { type: "nullish", structural: { wrapped: string() }, input: null },
  ]

  for (const { type, structural, input } of cases) {
    it(`a foreign "${type}" schema runs its own ~run, not the built-in fast path`, () => {
      const schema = collisionProbe(type, structural)
      // The probe always rejects; if the router specialized it by `.type`, the built-in fast
      // path would ACCEPT `input` and report success — the bypass. It must reject instead.
      expect(safeParseCompiled(schema, input).success).toBe(false)
      expectParity(schema, input)
    })
  }

  it("child-level collision: an object child and an array element route through ~run", () => {
    // Pins `primitiveCode`'s child-inline guard (it shares the same native-identity check).
    const objChild = object({ x: collisionProbe("string", {}) })
    expect(safeParseCompiled(objChild, { x: "ok" }).success).toBe(false)
    expectParity(objChild, { x: "ok" })
    const arrElem = array(collisionProbe("number", {}))
    expect(safeParseCompiled(arrElem, [42]).success).toBe(false)
    expectParity(arrElem, [42])
  })
})

describe("safeParseCompiled — `reference` factory identity is the documented trust boundary", () => {
  it("a schema that FORGES a native `reference` is treated as native (accepted non-goal, not a guarantee)", () => {
    // DOCUMENTED CONTRACT (see the TRUST BOUNDARY note in `compile`): specialization keys on
    // factory identity (`schema.reference`), the strongest non-symbol native-provenance signal.
    // A schema built through tskm's public factory API always carries BOTH the native `reference`
    // AND the matching `~run`, so the compiled path is byte-identical for every honest schema.
    // A schema that DELIBERATELY imports a native factory and assigns it to `reference` while
    // supplying a divergent `~run` is lying about its provenance; the compiled path trusts the
    // declared identity and specializes it, so it can diverge from `safeParse` here. That is an
    // accepted non-goal — forging `reference` is unsupported — not a bypass of the honest
    // contract. This test pins the boundary so narrowing it later (e.g. a module-private brand)
    // is a deliberate contract change, not an accidental regression.
    const forged: BaseSchema<unknown, unknown> = {
      kind: "schema",
      type: "string",
      reference: string, // forged native identity (real factory ref + divergent ~run below)
      expects: "string",
      async: false,
      get "~standard"(): never {
        throw new Error("~standard is unused in this test")
      },
      "~run"(dataset) {
        const out = dataset as { value: unknown; typed?: boolean; issues?: Issue[] }
        out.typed = false
        out.issues = [
          {
            kind: "schema",
            type: "string",
            expected: "never",
            received: String(out.value),
            message: "forged ~run rejects",
            input: out.value,
          },
        ]
        return out as OutputDataset<unknown>
      },
    }
    // Interpreter honors the forged `~run` (rejects); compiled trusts the declared native
    // identity and specializes (accepts). Documented, accepted divergence.
    expect(safeParse(forged, "x").success).toBe(false)
    expect(safeParseCompiled(forged, "x").success).toBe(true)
  })
})

/**
 * A custom schema whose `~run` reads `this.expects` (a real BaseSchema field) to carry the
 * expected JS `typeof`. Used only to prove the compiled fallback preserves `this` binding.
 */
function thisProbe(): BaseSchema<unknown, unknown> {
  const schema: BaseSchema<unknown, unknown> = {
    kind: "schema",
    type: "this_probe",
    reference: thisProbe,
    expects: "string",
    async: false,
    get "~standard"(): never {
      throw new Error("~standard is unused in this test")
    },
    "~run"(dataset) {
      const out = dataset as { value: unknown; typed?: boolean }
      out.typed = typeof out.value === this.expects
      return out as OutputDataset<unknown>
    },
  }
  return schema
}

/** The structural fields a `compileX` path reads before specializing — supplied per collision. */
interface ProbeStructural {
  readonly entries?: Record<string, BaseSchema<unknown, unknown>>
  readonly item?: BaseSchema<unknown, unknown>
  readonly wrapped?: BaseSchema<unknown, unknown>
}

/**
 * Builds a FOREIGN schema whose public `.type` collides with a built-in but whose `reference`
 * is NOT a native tskm factory. `structural` carries the field the matching `compileX` path
 * requires before it would specialize, so the disqualified `.type`-keyed router would take the
 * built-in fast path. The `~run` always rejects, so if the compiler ever specialized this
 * schema it would accept a built-in-valid input and diverge from the interpreter.
 */
function collisionProbe(
  type: string,
  structural: ProbeStructural,
): BaseSchema<unknown, unknown> & ProbeStructural {
  const schema: BaseSchema<unknown, unknown> & ProbeStructural = {
    kind: "schema",
    type,
    reference: collisionProbe,
    expects: "never",
    async: false,
    ...structural,
    get "~standard"(): never {
      throw new Error("~standard is unused in this test")
    },
    "~run"(dataset) {
      const out = dataset as { value: unknown; typed?: boolean; issues?: Issue[] }
      out.typed = false
      out.issues = [
        {
          kind: "schema",
          type,
          expected: "never",
          received: String(out.value),
          message: "collision probe always rejects",
          input: out.value,
        },
      ]
      return out as OutputDataset<unknown>
    },
  }
  return schema
}

/**
 * The GENERAL object step (the closure `compileObject` returns when a child is NOT an
 * inlineable native primitive — here a nested `object` child forces code 0) is a distinct
 * code path from the specialized primitive-strip fast paths the parity battery above already
 * exercises. Its inline `string`/`number`/`boolean` mismatch arms and its non-object guard
 * must stay byte-identical to the interpreter too.
 */
describe("safeParseCompiled — general object path parity", () => {
  const mixed = object({
    s: string(),
    n: number(),
    b: boolean(),
    nested: object({ x: string() }),
  })

  it("inline primitive leaves reject with interpreter-identical issues", () => {
    // All three inline arms take their else branch at once: wrong string, wrong number
    // (NaN counts as non-number), wrong boolean — each must emit its own typed issue.
    expectParity(mixed, { s: 5, n: "x", b: "no", nested: { x: 9 } })
    expectParity(mixed, { s: "ok", n: Number.NaN, b: true, nested: { x: "y" } })
    expectParity(mixed, { s: "ok", n: 1, b: true, nested: { x: "y" } })
  })

  it("non-object roots hit the object guard, not a primitive arm", () => {
    expectParity(mixed, 42)
    expectParity(mixed, null)
    expectParity(mixed, [])
    expectParity(mixed, "str")
  })

  it("optionalKeys + passthrough rest keeps the faithful-drop and rest merge byte-identical", () => {
    const schema = object(
      { name: string(), meta: object({ v: number() }), bio: optional(string()) },
      { optionalKeys: true, rest: "passthrough" },
    )
    // bio missing → faithfully dropped (not written as undefined); `extra` survives via passthrough.
    expectParity(schema, { name: "a", meta: { v: 1 }, extra: 99 })
    // bio present as undefined is distinct from missing under the faithful-optional contract.
    expectParity(schema, { name: "a", meta: { v: 1 }, bio: undefined })
    expectParity(schema, { name: "a", meta: { v: 2 }, bio: "hi", extra: [1, 2] })
  })
})

/**
 * Bare top-level `string`/`number`/`boolean` with a CUSTOM message compile to the
 * message-carrying closure (not the shared message-less `*Step`), and `nullish` roots go
 * through `compileNullish`. `safeParseCompiled` supports these roots even though the fast path
 * is meant for containers, so the compiled result must still match the interpreter exactly.
 */
describe("safeParseCompiled — top-level primitive & nullish parity", () => {
  it("custom-message primitives carry the message into the compiled issue", () => {
    expectParity(number("must be a number"), "nope")
    expectParity(number("must be a number"), 7)
    expectParity(string("must be a string"), 123)
    expectParity(string("must be a string"), "ok")
    expectParity(boolean("must be a boolean"), "x")
    expectParity(boolean("must be a boolean"), false)
  })

  it("nullish passes null/undefined through and defers to the wrapped schema otherwise", () => {
    const bare = nullish(string())
    expectParity(bare, null)
    expectParity(bare, undefined)
    expectParity(bare, "hi")
    expectParity(bare, 5)
  })

  it("nullish default (static and factory) fills only for null/undefined", () => {
    expectParity(nullish(string(), "fallback"), null)
    expectParity(nullish(string(), "fallback"), undefined)
    expectParity(nullish(string(), "fallback"), "kept")
    const dynamic = nullish(string(), () => "computed")
    expectParity(dynamic, null)
    expectParity(dynamic, undefined)
    expectParity(dynamic, "kept")
  })
})

/**
 * Prototype-pollution defense on the GENERAL compiled object path: an own `__proto__` input
 * key (only constructible via `JSON.parse`) copied into the fresh output must land as an own
 * data property via `_safeAssign`, never mutate the output's prototype — byte-identical to the
 * interpreter. A nested (non-primitive) child forces the general path rather than the
 * specialized primitive-strip fast paths, which have their own proto handling.
 */
describe("safeParseCompiled — general path __proto__ safety", () => {
  const withOwnProto = (
    base: Record<string, BaseSchema<unknown, unknown>>,
    value: BaseSchema<unknown, unknown>,
  ): Record<string, BaseSchema<unknown, unknown>> => {
    Object.defineProperty(base, "__proto__", {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
    return base
  }

  it("writes an own __proto__ key without polluting the prototype (general path)", () => {
    const entries = withOwnProto({ meta: object({ v: number() }) }, string())
    const schema = object(entries)
    const input = JSON.parse('{"__proto__": "x", "meta": {"v": 1}}')

    expectParity(schema, input)

    const compiled = safeParseCompiled(schema, input)
    expect(compiled.success).toBe(true)
    const out = compiled.output as Record<string, unknown>
    // Own data property, not a prototype mutation.
    expect(Object.hasOwn(out, "__proto__")).toBe(true)
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })
})
