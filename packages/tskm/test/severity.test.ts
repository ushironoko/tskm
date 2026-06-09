import { describe, expect, it } from "bun:test"
import {
  array,
  arrayAsync,
  assert,
  fallback,
  number,
  object,
  objectAsync,
  parse,
  parseAsync,
  pipe,
  pipeAsync,
  record,
  safeParse,
  safeParseAsync,
  string,
  transform,
  transformAsync,
  tuple,
  union,
  unionAsync,
} from "../src/index.ts"

/**
 * Issue severity, the transform diagnostic channel, and warning-vs-error semantics
 * (issue #21). Success is decided by error-severity; warnings are reported but non-fatal.
 */
describe("issue severity and the transform diagnostic channel (#21)", () => {
  const warned = pipe(
    string(),
    transform((value: string, ctx) => {
      ctx.issue("value was uppercased", "warning")
      return value.toUpperCase()
    }),
  )

  it("a warning keeps the parse successful and is carried on `warnings`", () => {
    const r = safeParse(warned, "hi")
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toBe("HI")
      expect(r.warnings).toHaveLength(1)
      expect(r.warnings[0]?.severity).toBe("warning")
    }
  })

  it("a warning does not make `parse` throw", () => {
    expect(parse(warned, "hi")).toBe("HI")
  })

  it("an error from a transform fails the parse", () => {
    const failing = pipe(
      string(),
      transform((value: string, ctx) => {
        ctx.issue("not allowed")
        return value
      }),
    )
    const r = safeParse(failing, "hi")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
    }
  })

  it("a plain (input) => output transform still works", () => {
    const plain = pipe(
      string(),
      transform((value: string) => value.length),
    )
    expect(parse(plain, "abcd")).toBe(4)
  })

  it("a warning is not a Standard Schema failure and severity never leaks", () => {
    const ok = warned["~standard"].validate("hi")
    expect("issues" in ok && ok.issues !== undefined).toBe(false)

    const failing = pipe(
      string(),
      transform((value: string, ctx) => {
        ctx.issue("boom")
        return value
      }),
    )
    const bad = failing["~standard"].validate("hi")
    if (!(bad instanceof Promise) && "issues" in bad && bad.issues) {
      expect(Object.keys(bad.issues[0] ?? {}).sort()).toEqual(["message"])
    } else {
      throw new Error("expected a failure result with issues")
    }
  })

  it("reject mode bails at the first error, report collects all", () => {
    const schema = object({ a: number(), b: number() })
    const reject = safeParse(schema, { a: "x", b: "y" }, { mode: "reject" })
    const report = safeParse(schema, { a: "x", b: "y" }, { mode: "report" })
    expect(reject.success).toBe(false)
    expect(report.success).toBe(false)
    if (!reject.success && !report.success) {
      expect(reject.issues).toHaveLength(1)
      expect(report.issues).toHaveLength(2)
    }
  })
})

describe("warning consistency across read sites (#21)", () => {
  const warned = pipe(
    string(),
    transform((value: string, ctx) => {
      ctx.issue("deprecated", "warning")
      return value.toUpperCase()
    }),
  )

  it("union accepts a member that produced only a warning", () => {
    const r = safeParse(union([number(), warned]), "hi")
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toBe("HI")
      expect(r.warnings).toHaveLength(1)
    }
  })

  it("fallback keeps the real value over a warning-only result", () => {
    expect(parse(fallback(warned, "DEFAULT"), "hi")).toBe("HI")
  })

  it("assert does not throw on a warning-only parse", () => {
    expect(() => assert(warned, "hi")).not.toThrow()
  })

  it("a reject-mode container does not abort on a warning-only child", () => {
    const r = safeParse(object({ a: warned }), { a: "hi" }, { mode: "reject" })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({ a: "HI" })
    }
  })

  it("an unknown/typo severity is fail-closed (treated as an error, kept visible)", () => {
    // A JS caller (modeled with `as any`) can pass a typo severity through the public
    // `ctx.issue` API. It must NOT vanish into a successful parse: only an exact
    // `"warning"` is non-fatal, so a typo fails the parse and stays in `issues`.
    const schema = pipe(
      string(),
      transform((value: string, ctx) => {
        // Model an untyped JS caller passing a typo severity. The cast only widens the
        // severity parameter from `"error" | "warning"` to `string` (the message stays
        // typed) — the weakest cast that lets us reach the runtime guard, no `any` needed.
        ;(ctx.issue as (m: string, s: string) => void)("typo severity", "warn")
        return value
      }),
    )
    const r = safeParse(schema, "hi")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues.some((i) => i.message === "typo severity")).toBe(true)
      expect(r.warnings).toHaveLength(0)
    }
  })

  it("transformAsync carries a warning the same way (async diagnostic path)", async () => {
    const schema = pipeAsync(
      string(),
      transformAsync(async (value: string, ctx) => {
        ctx.issue("async deprecated", "warning")
        return value.toUpperCase()
      }),
    )
    const r = await safeParseAsync(schema, "hi")
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toBe("HI")
      expect(r.warnings).toHaveLength(1)
    }
  })

  it("safeParseAsync exposes an empty `warnings` array on a warning-free parse (sync parity)", async () => {
    // The result-shape contract is symmetric: `warnings` is always present, and a parse with
    // no warnings carries an empty array (not `undefined`/omitted) on both sync and async.
    const r = await safeParseAsync(string(), "hi")
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.warnings).toHaveLength(0)
    }
  })
})

describe("warning is non-fatal at every container/method read site (#21)", () => {
  const warned = pipe(
    string(),
    transform((value: string, ctx) => {
      ctx.issue("deprecated", "warning")
      return value.toUpperCase()
    }),
  )
  const warnedAsync = pipeAsync(
    string(),
    transformAsync(async (value: string, ctx) => {
      ctx.issue("deprecated", "warning")
      return value.toUpperCase()
    }),
  )

  it("array carries a child warning and still succeeds", () => {
    const r = safeParse(array(warned), ["hi", "yo"])
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual(["HI", "YO"])
      expect(r.warnings).toHaveLength(2)
    }
  })

  it("arrayAsync carries a child warning and still succeeds", async () => {
    const r = await safeParseAsync(arrayAsync(warnedAsync), ["hi"])
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.warnings).toHaveLength(1)
    }
  })

  it("tuple carries a member warning and still succeeds", () => {
    const r = safeParse(tuple([warned, number()]), ["hi", 1])
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual(["HI", 1])
      expect(r.warnings).toHaveLength(1)
    }
  })

  it("record carries a value warning and still succeeds", () => {
    const r = safeParse(record(warned), { a: "hi" })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({ a: "HI" })
      expect(r.warnings).toHaveLength(1)
    }
  })

  it("objectAsync carries a value warning and still succeeds", async () => {
    const r = await safeParseAsync(objectAsync({ a: warnedAsync }), { a: "hi" })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({ a: "HI" })
      expect(r.warnings).toHaveLength(1)
    }
  })

  it("unionAsync accepts a member that produced only a warning", async () => {
    const r = await safeParseAsync(unionAsync([number(), warnedAsync]), "hi")
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toBe("HI")
      expect(r.warnings).toHaveLength(1)
    }
  })

  it("parseAsync returns the value on a warning-only parse (does not throw)", async () => {
    expect(await parseAsync(warnedAsync, "hi")).toBe("HI")
  })

  it("a pipe warning does NOT short-circuit later pipe items (sync)", () => {
    let secondRan = false
    const schema = pipe(
      string(),
      transform((value: string, ctx) => {
        ctx.issue("deprecated", "warning")
        return value
      }),
      transform((value: string) => {
        secondRan = true
        return value.toUpperCase()
      }),
    )
    const r = safeParse(schema, "hi")
    expect(r.success).toBe(true)
    expect(secondRan).toBe(true)
    if (r.success) {
      expect(r.output).toBe("HI")
      expect(r.warnings).toHaveLength(1)
    }
  })

  it("a pipeAsync warning does NOT short-circuit later items (async)", async () => {
    let secondRan = false
    const schema = pipeAsync(
      string(),
      transformAsync(async (value: string, ctx) => {
        ctx.issue("deprecated", "warning")
        return value
      }),
      transformAsync(async (value: string) => {
        secondRan = true
        return value.toUpperCase()
      }),
    )
    const r = await safeParseAsync(schema, "hi")
    expect(r.success).toBe(true)
    expect(secondRan).toBe(true)
    if (r.success) {
      expect(r.output).toBe("HI")
      expect(r.warnings).toHaveLength(1)
    }
  })
})
