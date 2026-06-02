import { describe, expect, it } from "bun:test"
import {
  assert,
  checkAsync,
  fallback,
  is,
  minLength,
  number,
  object,
  parse,
  parseAsync,
  pipe,
  pipeAsync,
  safeParse,
  safeParseAsync,
  string,
  transform,
  transformAsync,
} from "../src/index.ts"

describe("parseAsync", () => {
  it("resolves the typed output for a sync schema", async () => {
    await expect(parseAsync(string(), "hi")).resolves.toBe("hi")
  })

  it("resolves through an async pipe (awaits each step)", async () => {
    const schema = pipeAsync(
      string(),
      transformAsync(async (s: string) => s.length),
    )
    await expect(parseAsync(schema, "abcd")).resolves.toBe(4)
  })

  it("rejects with a tskmError when validation fails", async () => {
    await expect(parseAsync(string(), 123)).rejects.toThrow()
  })

  it("rejection carries the issues array", async () => {
    try {
      await parseAsync(number(), "nope")
      throw new Error("should not reach")
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect(Array.isArray((e as { issues?: unknown }).issues)).toBe(true)
    }
  })

  it("rejects when an async refinement step fails", async () => {
    const schema = pipeAsync(
      string(),
      checkAsync(async (s: string) => s.length > 2, "too short"),
    )
    await expect(parseAsync(schema, "a")).rejects.toThrow("too short")
  })
})

describe("safeParseAsync", () => {
  it("returns success for a sync schema", async () => {
    const r = await safeParseAsync(string(), "ok")
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toBe("ok")
      expect(r.issues).toBeUndefined()
    }
  })

  it("returns failure (no throw) with issues for a sync schema", async () => {
    const r = await safeParseAsync(string(), 1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues.length).toBeGreaterThanOrEqual(1)
    }
  })

  it("resolves an async pipe success and threads the transformed value", async () => {
    const schema = pipeAsync(
      string(),
      transformAsync(async (s: string) => `${s}!`),
    )
    const r = await safeParseAsync(schema, "yo")
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toBe("yo!")
    }
  })

  it("reports failure from an async check inside a pipe", async () => {
    const schema = pipeAsync(
      number(),
      checkAsync(async (n: number) => n > 0, "must be positive"),
    )
    const r = await safeParseAsync(schema, -1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("must be positive")
    }
  })
})

describe("assert", () => {
  it("returns undefined (void) and narrows on success", () => {
    const value: unknown = "narrow-me"
    expect(assert(string(), value)).toBeUndefined()
    // After assert, `value` is `string`; calling a string method type-checks.
    assert(string(), value)
    expect(value.toUpperCase()).toBe("NARROW-ME")
  })

  it("throws a tskmError on failure", () => {
    expect(() => assert(number(), "x")).toThrow()
  })

  it("thrown error carries the failing issues", () => {
    try {
      assert(number(), "x")
      throw new Error("should not reach")
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).name).toBe("TskmError")
      expect(Array.isArray((e as { issues?: unknown }).issues)).toBe(true)
    }
  })

  it("throws when a piped refinement fails even though the base type matches", () => {
    expect(() => assert(pipe(string(), minLength(5)), "ab")).toThrow()
  })
})

describe("is", () => {
  it("returns true for a matching value", () => {
    expect(is(string(), "hi")).toBe(true)
  })

  it("returns false for a non-matching value", () => {
    expect(is(string(), 42)).toBe(false)
  })

  it("returns false when a piped refinement fails", () => {
    expect(is(pipe(string(), minLength(3)), "ab")).toBe(false)
  })

  it("narrows the value type in the true branch", () => {
    const value: unknown = "abc"
    if (is(string(), value)) {
      expect(value.length).toBe(3)
    } else {
      throw new Error("expected narrowing branch")
    }
  })
})

describe("fallback", () => {
  it("returns the parsed value when validation succeeds", () => {
    const schema = fallback(string(), "DEFAULT")
    expect(parse(schema, "real")).toBe("real")
  })

  it("returns the fallback when validation fails (wrong shape)", () => {
    const schema = fallback(string(), "DEFAULT")
    expect(parse(schema, 999)).toBe("DEFAULT")
  })

  it("recovers from a failed refinement, not just wrong-shape input", () => {
    const schema = fallback(pipe(string(), minLength(5)), "fallback-value")
    expect(parse(schema, "ab")).toBe("fallback-value")
    expect(parse(schema, "abcdef")).toBe("abcdef")
  })

  it("safeParse on a fallback always succeeds", () => {
    const schema = fallback(number(), 0)
    const r = safeParse(schema, "not-a-number")
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toBe(0)
    }
  })

  it("exposes its descriptive shape and leaves the wrapped schema untouched", () => {
    const inner = string()
    const schema = fallback(inner, "x")
    expect(schema.type).toBe("fallback")
    expect(schema.reference).toBe(fallback)
    expect(schema.wrapped).toBe(inner)
    expect(schema.fallback).toBe("x")
    expect(schema.async).toBe(false)
    expect(schema.expects).toBe(inner.expects)
  })

  it("integrates with the Standard Schema surface", () => {
    const schema = fallback(string(), "fb")
    expect(schema["~standard"].validate(123)).toEqual({ value: "fb" })
    expect(schema["~standard"].validate("ok")).toEqual({ value: "ok" })
  })
})

describe("pipe", () => {
  it("threads a value through a single transformation", () => {
    const schema = pipe(
      string(),
      transform((s: string) => s.length),
    )
    expect(parse(schema, "abc")).toBe(3)
  })

  it("runs a multi-step transform + validation chain", () => {
    const schema = pipe(
      string(),
      transform((s: string) => s.trim()),
      minLength(2),
    )
    expect(parse(schema, "  hi  ")).toBe("hi")
  })

  it("reports failure when a validation step fails", () => {
    const schema = pipe(string(), minLength(5))
    const r = safeParse(schema, "ab")
    expect(r.success).toBe(false)
  })

  it("does not run a transformation after the value became untyped", () => {
    // The base schema rejects the input → dataset is untyped → the transform
    // (which would throw on a non-string) must be skipped, leaving issues intact.
    const schema = pipe(
      string(),
      transform((s: string) => s.toUpperCase()),
    )
    const r = safeParse(schema, 123)
    expect(r.success).toBe(false)
  })

  it("short-circuits an early failing step under abortPipeEarly", () => {
    let secondRan = false
    const schema = pipe(
      string(),
      minLength(5),
      transform((s: string) => {
        secondRan = true
        return s
      }),
    )
    const r = safeParse(schema, "ab", { abortPipeEarly: true })
    expect(r.success).toBe(false)
    expect(secondRan).toBe(false)
  })

  it("short-circuits under abortEarly as well", () => {
    let secondRan = false
    const schema = pipe(
      string(),
      minLength(5),
      transform((s: string) => {
        secondRan = true
        return s
      }),
    )
    const r = safeParse(schema, "ab", { abortEarly: true })
    expect(r.success).toBe(false)
    expect(secondRan).toBe(false)
  })

  it("without an abort flag, later steps still run after an earlier issue", () => {
    let secondRan = false
    const schema = pipe(
      string(),
      minLength(5),
      transform((s: string) => {
        secondRan = true
        return s
      }),
    )
    const r = safeParse(schema, "ab")
    expect(r.success).toBe(false)
    // A typed-but-failed dataset still flows into the transformation step.
    expect(secondRan).toBe(true)
  })

  it("returns a new schema carrying the pipe tuple; the original is untouched", () => {
    const base = string()
    const schema = pipe(base, minLength(2))
    expect(schema.pipe[0]).toBe(base)
    expect(schema.pipe.length).toBe(2)
    expect("pipe" in base).toBe(false)
  })

  it("piped ~standard derives from the piped run, not the bare base", () => {
    const schema = pipe(string(), minLength(5))
    const result = schema["~standard"].validate("ab")
    expect("issues" in result && result.issues !== undefined).toBe(true)
  })
})

describe("pipeAsync", () => {
  it("composes a sync schema with async transform/check steps", async () => {
    const schema = pipeAsync(
      object({ name: string() }),
      transformAsync(async (v: { name: string }) => v.name),
      checkAsync(async (name: string) => name.length > 1, "name too short"),
    )
    const r = await safeParseAsync(schema, { name: "ab" })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toBe("ab")
    }
  })

  it("marks the resulting schema as async and records the pipe tuple", () => {
    const base = string()
    const schema = pipeAsync(
      base,
      checkAsync(async () => true),
    )
    expect(schema.async).toBe(true)
    expect(schema.pipe[0]).toBe(base)
    expect(schema.pipe.length).toBe(2)
  })

  it("skips an async transformation once the value is untyped", async () => {
    let transformRan = false
    const schema = pipeAsync(
      string(),
      transformAsync(async (s: string) => {
        transformRan = true
        return s
      }),
    )
    const r = await safeParseAsync(schema, 123)
    expect(r.success).toBe(false)
    expect(transformRan).toBe(false)
  })

  it("short-circuits async steps under abortPipeEarly", async () => {
    let checkRan = false
    const schema = pipeAsync(
      string(),
      minLength(5),
      checkAsync(async () => {
        checkRan = true
        return true
      }),
    )
    const r = await safeParseAsync(schema, "ab", { abortPipeEarly: true })
    expect(r.success).toBe(false)
    expect(checkRan).toBe(false)
  })

  it("runs later async steps when no abort flag is set", async () => {
    let checkRan = false
    const schema = pipeAsync(
      string(),
      minLength(5),
      checkAsync(async () => {
        checkRan = true
        return true
      }),
    )
    const r = await safeParseAsync(schema, "ab")
    expect(r.success).toBe(false)
    expect(checkRan).toBe(true)
  })

  it("async ~standard derives from the piped async run", async () => {
    const schema = pipeAsync(
      string(),
      checkAsync(async (s: string) => s.length >= 5, "short"),
    )
    const result = await schema["~standard"].validate("ab")
    expect("issues" in result && result.issues !== undefined).toBe(true)
  })
})

describe("safeParse (covered alongside the other methods)", () => {
  it("success result has output and undefined issues", () => {
    const r = safeParse(number(), 7)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toBe(7)
      expect(r.issues).toBeUndefined()
    }
  })

  it("failure result exposes the raw output and issues", () => {
    const r = safeParse(number(), "x")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.output).toBe("x")
      expect(r.issues.length).toBeGreaterThanOrEqual(1)
    }
  })
})
