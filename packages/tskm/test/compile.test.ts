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

/**
 * STRYKER ORACLE (wiring deferred). This battery is the mutation oracle for `compile.ts`.
 * It already KILLS the mutants that matter: verified manually that replacing the `.pipe`
 * fallback guard in `compile()` with `false` (which would reintroduce the disqualified PoC's
 * validation bypass) fails 6 cases here. When Stryker lands on `main` (it currently lives on
 * the unmerged `test/stryker-mutation` branch, so its config is not touched here), wire it as:
 *   1. add `packages/tskm/src/compile.ts` to Stryker's `mutate` targets;
 *   2. require this file to KILL every mutant on these survival-critical sites: the `.pipe` /
 *      `async` fallback guard, each primitive inline fast-path branch, the `prefixIssuePaths`
 *      index range, the faithful-optional drop condition, and the `hasErrorIssueFrom`/`isReject`
 *      abort condition;
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
