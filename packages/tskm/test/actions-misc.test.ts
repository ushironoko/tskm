import { describe, expect, it } from "bun:test"
import {
  brand,
  check,
  checkAsync,
  number,
  parse,
  parseAsync,
  pipe,
  pipeAsync,
  readonly,
  safeParse,
  safeParseAsync,
  string,
  transform,
  transformAsync,
} from "../src/index.ts"

describe("transform", () => {
  it("builds an action with the expected static shape", () => {
    const action = transform((s: string) => s.length)
    expect(action.kind).toBe("transformation")
    expect(action.type).toBe("transform")
    expect(action.reference).toBe(transform)
    expect(action.async).toBe(false)
    expect(action.operation("abcd", { issue: () => {} })).toBe(4)
  })

  it("maps the output value through the pipe", () => {
    expect(
      parse(
        pipe(
          string(),
          transform((s: string) => s.length),
        ),
        "abcd",
      ),
    ).toBe(4)
  })

  it("chains multiple transforms left-to-right", () => {
    const schema = pipe(
      string(),
      transform((s: string) => s.length),
      transform((n: number) => n * 2),
    )
    expect(parse(schema, "abc")).toBe(6)
  })

  it("does not run the transform when the schema itself fails", () => {
    let called = false
    const schema = pipe(
      string(),
      transform((s: string) => {
        called = true
        return s.length
      }),
    )
    const r = safeParse(schema, 123)
    expect(r.success).toBe(false)
    expect(called).toBe(false)
  })
})

describe("transformAsync", () => {
  it("builds an async action with the expected static shape", () => {
    const action = transformAsync(async (s: string) => s.length)
    expect(action.kind).toBe("transformation")
    expect(action.type).toBe("transform")
    expect(action.reference).toBe(transformAsync)
    expect(action.async).toBe(true)
  })

  it("maps the output value through the async pipe", async () => {
    const schema = pipeAsync(
      string(),
      transformAsync(async (s: string) => s.length),
    )
    expect(await parseAsync(schema, "abcd")).toBe(4)
  })

  it("threads through a following sync transform", async () => {
    const schema = pipeAsync(
      string(),
      transformAsync(async (s: string) => s.length),
      transform((n: number) => n + 1),
    )
    expect(await parseAsync(schema, "abc")).toBe(4)
  })

  it("skips the async transform when the base schema fails", async () => {
    let called = false
    const schema = pipeAsync(
      string(),
      transformAsync(async (s: string) => {
        called = true
        return s.length
      }),
    )
    const r = await safeParseAsync(schema, 123)
    expect(r.success).toBe(false)
    expect(called).toBe(false)
  })
})

describe("check", () => {
  it("builds an action with the expected static shape", () => {
    const action = check((n: number) => n > 0, "must be positive")
    expect(action.kind).toBe("validation")
    expect(action.type).toBe("check")
    expect(action.reference).toBe(check)
    expect(action.expects).toBe(null)
    expect(action.async).toBe(false)
    expect(action.message).toBe("must be positive")
    expect(action.requirement(1)).toBe(true)
  })

  it("passes through the value when the predicate is satisfied", () => {
    const schema = pipe(
      number(),
      check((n: number) => n > 0, "must be positive"),
    )
    expect(parse(schema, 5)).toBe(5)
  })

  it("adds an issue with the supplied message when the predicate fails", () => {
    const schema = pipe(
      number(),
      check((n: number) => n > 0, "must be positive"),
    )
    const r = safeParse(schema, -1)
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.kind).toBe("validation")
      expect(issue?.type).toBe("check")
      expect(issue?.expected).toBe(null)
      expect(issue?.message).toBe("must be positive")
    }
  })

  it("falls back to a default message when none is supplied", () => {
    const schema = pipe(
      number(),
      check((n: number) => n > 0),
    )
    const action = check((n: number) => n > 0)
    expect(action.message).toBeUndefined()
    const r = safeParse(schema, -1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("Invalid check: Received -1")
    }
  })
})

describe("checkAsync", () => {
  it("builds an async action with the expected static shape", () => {
    const action = checkAsync(async (n: number) => n > 0, "must be positive")
    expect(action.kind).toBe("validation")
    expect(action.type).toBe("check")
    expect(action.reference).toBe(checkAsync)
    expect(action.expects).toBe(null)
    expect(action.async).toBe(true)
    expect(action.message).toBe("must be positive")
  })

  it("passes through the value when the async predicate is satisfied", async () => {
    const schema = pipeAsync(
      number(),
      checkAsync(async (n: number) => n > 0, "must be positive"),
    )
    expect(await parseAsync(schema, 5)).toBe(5)
  })

  it("adds an issue with the supplied message when the async predicate fails", async () => {
    const schema = pipeAsync(
      number(),
      checkAsync(async (n: number) => n > 0, "must be positive"),
    )
    const r = await safeParseAsync(schema, -1)
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.kind).toBe("validation")
      expect(issue?.type).toBe("check")
      expect(issue?.expected).toBe(null)
      expect(issue?.message).toBe("must be positive")
    }
  })

  it("falls back to a default message when none is supplied", async () => {
    const schema = pipeAsync(
      number(),
      checkAsync(async (n: number) => n > 0),
    )
    const r = await safeParseAsync(schema, -1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("Invalid check: Received -1")
    }
  })

  it("skips the async check when the base schema is untyped", async () => {
    let called = false
    const schema = pipeAsync(
      number(),
      checkAsync(async (n: number) => {
        called = true
        return n > 0
      }),
    )
    const r = await safeParseAsync(schema, "nope")
    expect(r.success).toBe(false)
    expect(called).toBe(false)
  })
})

describe("brand", () => {
  it("builds an action with the expected static shape", () => {
    const action = brand<string, "Id">("Id")
    expect(action.kind).toBe("transformation")
    expect(action.type).toBe("brand")
    expect(action.reference).toBe(brand)
    expect(action.async).toBe(false)
    expect(action.name).toBe("Id")
  })

  it("passes the runtime value through unchanged", () => {
    const schema = pipe(string(), brand<string, "Id">("Id"))
    expect(parse(schema, "abc") as string).toBe("abc")
  })

  it("supports symbol brand names", () => {
    const sym = Symbol("Id")
    const action = brand<string, typeof sym>(sym)
    expect(action.name).toBe(sym)
  })
})

describe("readonly", () => {
  it("builds an action with the expected static shape", () => {
    const action = readonly<string>()
    expect(action.kind).toBe("transformation")
    expect(action.type).toBe("readonly")
    expect(action.reference).toBe(readonly)
    expect(action.async).toBe(false)
  })

  it("passes the runtime value through unchanged", () => {
    const schema = pipe(string(), readonly<string>())
    expect(parse(schema, "abc")).toBe("abc")
  })

  it("preserves the object reference produced by a prior transform", () => {
    const obj = { a: 1 }
    const schema = pipe(
      string(),
      transform(() => obj),
      readonly<{ a: number }>(),
    )
    // transform yields `obj`; readonly is a runtime passthrough, so identity holds.
    expect(parse(schema, "x")).toBe(obj)
  })
})
