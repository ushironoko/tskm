import { describe, expect, it } from "bun:test"
import {
  array,
  boolean,
  is,
  isTskmError,
  maxValue,
  minLength,
  minValue,
  number,
  object,
  objectAsync,
  optional,
  parse,
  parseAsync,
  pipe,
  pipeAsync,
  preprocess,
  preprocessAsync,
  safeParse,
  safeParseAsync,
  string,
  templateLiteral,
  transform,
  transformAsync,
  union,
} from "../src/index.ts"

function failure(schema: Parameters<typeof safeParse>[0], input: unknown) {
  const result = safeParse(schema, input)
  expect(result.success).toBe(false)
  if (result.success) {
    throw new Error("expected a failure result")
  }
  return result
}

async function failureAsync(schema: Parameters<typeof safeParseAsync>[0], input: unknown) {
  const result = await safeParseAsync(schema, input)
  expect(result.success).toBe(false)
  if (result.success) {
    throw new Error("expected a failure result")
  }
  return result
}

function decimalString(value: unknown): unknown {
  if (typeof value !== "string") return value
  return Number(value)
}

describe("preprocess", () => {
  it("validates the converted value in a later pipe step", () => {
    const port = pipe(preprocess(decimalString, number()), minValue(1), maxValue(65535))
    expect(port.type).toBe("preprocess")
    expect(parse(port, "8080")).toBe(8080)
    expect(parse(port, 3000)).toBe(3000)
    const zero = failure(port, "0")
    expect(zero.issues[0]?.type).toBe("min_value")
    const nope = failure(port, "nope")
    expect(nope.issues[0]?.type).toBe("number")
    expect(nope.output).toBeNaN()
  })

  it("runs inside optional and array instead of skipping the wrapper", () => {
    let calls = 0
    const wrapped = optional(
      preprocess((value) => {
        calls += 1
        return Number(value)
      }, number()),
    )
    expect(parse(wrapped, undefined)).toBeUndefined()
    expect(calls).toBe(0)
    expect(parse(wrapped, "4")).toBe(4)
    expect(calls).toBe(1)
    expect(parse(array(preprocess(decimalString, number())), ["1", "2"])).toEqual([1, 2])
  })

  it("reports a number failure on the object key path", () => {
    const schema = object({ port: preprocess(decimalString, number()) })
    const result = failure(schema, { port: "nope" })
    expect(result.issues[0]?.type).toBe("number")
    expect(result.issues[0]?.path).toEqual([{ key: "port" }])
  })

  it("converts string flags without Boolean()", () => {
    const verbose = preprocess((value) => {
      if (typeof value !== "string") return value
      return value === "true" || value === "1"
    }, boolean())
    expect(parse(verbose, "true")).toBe(true)
    expect(parse(verbose, "1")).toBe(true)
    expect(parse(verbose, "false")).toBe(false)
    expect(parse(verbose, "0")).toBe(false)
    expect(parse(verbose, true)).toBe(true)
    expect(parse(verbose, false)).toBe(false)
  })

  it("runs before validation and skips a later transform when the inner schema fails", () => {
    let ran = false
    const schema = pipe(
      preprocess((value) => String(value), string()),
      minLength(1),
      transform((text: string) => {
        ran = true
        return text.length
      }),
    )
    expect(parse(schema, 12)).toBe(2)
    expect(ran).toBe(true)

    ran = false
    const converted = pipe(
      preprocess(decimalString, number()),
      transform(() => {
        ran = true
        return 1
      }),
    )
    const result = failure(converted, "nope")
    expect(result.issues[0]?.type).toBe("number")
    expect(ran).toBe(false)
  })

  it("records an Error throw and does not run the inner schema", () => {
    const schema = preprocess(() => {
      throw new Error("boom")
    }, number())
    const result = failure(schema, "x")
    expect(result.output).toBe("x")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      kind: "transformation",
      type: "preprocess",
      message: "Invalid preprocess: boom",
      input: "x",
      severity: "error",
    })
    try {
      parse(schema, "x")
      throw new Error("parse should have thrown")
    } catch (error) {
      expect(isTskmError(error)).toBe(true)
      if (isTskmError(error)) {
        expect(error.issues[0]?.message).toBe("Invalid preprocess: boom")
      }
    }
  })

  it("stringifies a non-Error throw with String()", () => {
    const fromString = failure(
      preprocess(() => {
        throw "nope"
      }, string()),
      1,
    )
    expect(fromString.issues[0]?.message).toBe("Invalid preprocess: nope")
    expect(fromString.output).toBe(1)

    const fromUndefined = failure(
      preprocess(() => {
        throw undefined
      }, string()),
      "keep",
    )
    expect(fromUndefined.issues[0]?.message).toBe("Invalid preprocess: undefined")
    expect(fromUndefined.output).toBe("keep")
  })

  it("keeps ctx issues recorded before a throw and skips the inner schema", () => {
    const schema = preprocess((_value, ctx) => {
      ctx.issue("before")
      throw new Error("boom")
    }, number())
    const result = failure(schema, "5")
    expect(result.output).toBe("5")
    expect(result.issues.map((issue) => issue.message)).toEqual([
      "before",
      "Invalid preprocess: boom",
    ])
    expect(result.issues.every((issue) => issue.type === "preprocess")).toBe(true)
  })

  it("skips the inner schema when ctx.issue records an error", () => {
    const schema = preprocess((_value, ctx) => {
      ctx.issue("stop")
      return 1
    }, number())
    const result = failure(schema, "5")
    expect(result.output).toBe("5")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({ type: "preprocess", message: "stop", input: "5" })
  })

  it("runs the inner schema after a warning and keeps the warning", () => {
    const schema = preprocess((value, ctx) => {
      ctx.issue("heads up", "warning")
      return Number(value)
    }, number())
    const ok = safeParse(schema, "5")
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.output).toBe(5)
      expect(ok.warnings.map((issue) => issue.message)).toEqual(["heads up"])
    }
    const bad = failure(
      preprocess((value, ctx) => {
        ctx.issue("heads up", "warning")
        return value
      }, number()),
      "nope",
    )
    expect(bad.issues.map((issue) => issue.type)).toEqual(["preprocess", "number"])
    expect(bad.warnings).toHaveLength(1)
  })

  it("untypes the dataset when preprocess throws, even if it arrived typed", () => {
    const schema = preprocess(() => {
      throw new Error("boom")
    }, string())
    const dataset = { value: "x", typed: true as const }
    const result = schema["~run"](dataset as never, {})
    expect(result.typed).toBe(false)
    expect(result.value).toBe("x")
  })

  it("rejects a preprocess placeholder in templateLiteral", () => {
    expect(() => templateLiteral([preprocess(decimalString, number())])).toThrow(
      /unsupported placeholder/,
    )
  })

  it("keeps schema metadata and an unset issues list on a clean run", () => {
    const schema = preprocess((value) => value, string())
    expect(schema.kind).toBe("schema")
    expect(schema.type).toBe("preprocess")
    expect(schema.expects).toBe("string")
    expect(schema.async).toBe(false)
    const clean = schema["~run"]({ value: "hi" }, {})
    expect(clean.typed).toBe(true)
    expect(clean.value).toBe("hi")
    expect(clean.issues).toBeUndefined()

    const stopped = preprocess((_value, ctx) => {
      ctx.issue("stop")
      return "x"
    }, string())
    const failed = stopped["~run"]({ value: "in" }, {})
    expect(failed.issues?.[0]?.severity).toBe("error")
  })

  it("lets an inner transform throw propagate unchanged", () => {
    const inner = new Error("inner boom")
    const schema = preprocess(
      (value) => value,
      pipe(
        string(),
        transform(() => {
          throw inner
        }),
      ),
    )
    try {
      schema["~run"]({ value: "hi" }, {})
      throw new Error("inner throw should have propagated")
    } catch (error) {
      expect(error).toBe(inner)
    }
    try {
      parse(schema, "hi")
      throw new Error("parse should have thrown the inner error")
    } catch (error) {
      expect(error).toBe(inner)
      expect(isTskmError(error)).toBe(false)
    }
  })

  it("rejects a thenable operation and does not run the inner schema", () => {
    const schema = preprocess(
      () => ({
        // biome-ignore lint/suspicious/noThenProperty: the value under test is a thenable
        then() {
          // Promise.resolve adopts the thenable to attach a rejection handler.
        },
      }),
      number(),
    )
    const result = failure(schema, "4")
    expect(result.output).toBe("4")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      kind: "transformation",
      type: "preprocess",
      severity: "error",
      message: "Invalid preprocess: operation returned a Promise; use preprocessAsync",
      input: "4",
    })

    const asyncFn = failure(
      preprocess(async (value) => Number(value), number()),
      "4",
    )
    expect(asyncFn.output).toBe("4")
    expect(asyncFn.issues[0]?.type).toBe("preprocess")
    expect(asyncFn.issues[0]?.message).toBe(
      "Invalid preprocess: operation returned a Promise; use preprocessAsync",
    )
  })

  it("swallows a rejected thenable without an unhandledRejection", async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      const result = failure(
        preprocess(() => Promise.reject(new Error("x")), number()),
        "4",
      )
      expect(result.output).toBe("4")
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0]).toMatchObject({
        type: "preprocess",
        message: "Invalid preprocess: operation returned a Promise; use preprocessAsync",
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  it("treats a function with a then method as a thenable", () => {
    const fn = (() => 1) as { (): number; then?: () => void }
    // biome-ignore lint/suspicious/noThenProperty: function-valued thenable
    fn.then = () => {}
    const result = failure(
      preprocess(() => fn, number()),
      "4",
    )
    expect(result.output).toBe("4")
    expect(result.issues[0]?.type).toBe("preprocess")
    expect(result.issues[0]?.message).toBe(
      "Invalid preprocess: operation returned a Promise; use preprocessAsync",
    )
  })

  it("does not treat undefined as a thenable", () => {
    const result = failure(
      preprocess(() => undefined, string()),
      1,
    )
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.type).toBe("string")
  })

  it("does not treat null as a thenable", () => {
    const result = failure(
      preprocess(() => null, string()),
      1,
    )
    expect(result.issues[0]?.type).toBe("string")
    expect(result.issues).toHaveLength(1)
  })

  it("uses the inner expects string so a union message stays readable", () => {
    const converted = preprocess(decimalString, number())
    expect(converted.expects).toBe("number")
    const schema = union([converted, string()])
    expect(schema.expects).toBe("number | string")
    const result = failure(schema, undefined)
    expect(result.issues[0]?.message).toBe(
      "Invalid type: Expected number | string but received undefined",
    )
  })

  it("does not change the original value that is() accepts", () => {
    const value = "8080"
    expect(is(preprocess(decimalString, number()), value)).toBe(true)
    expect(value).toBe("8080")
  })
})

describe("preprocessAsync", () => {
  it("converts through an async operation and an async inner schema", async () => {
    const marked = preprocessAsync(async (value) => value, string())
    expect(marked.kind).toBe("schema")
    expect(marked.type).toBe("preprocess")
    expect(marked.expects).toBe("string")
    expect(marked.async).toBe(true)
    expect(marked.reference).toBe(preprocessAsync)
    const clean = await marked["~run"]({ value: "hi" }, {})
    expect(clean.value).toBe("hi")
    expect(clean.issues).toBeUndefined()

    const stopped = preprocessAsync(async (_value, ctx) => {
      ctx.issue("stop")
      return "x"
    }, string())
    const failed = await stopped["~run"]({ value: "in" }, {})
    expect(failed.issues?.[0]?.severity).toBe("error")

    const syncInner = preprocessAsync(async (value) => Number(value), number())
    await expect(parseAsync(syncInner, "4")).resolves.toBe(4)

    const asyncInner = preprocessAsync(async (value) => value, objectAsync({ a: string() }))
    const ok = await safeParseAsync(asyncInner, { a: "x" })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.output).toEqual({ a: "x" })
    }
    const bad = await failureAsync(asyncInner, { a: 1 })
    expect(bad.issues[0]?.type).toBe("string")
  })

  it("records an Error rejection and a non-Error rejection", async () => {
    const errorReject = preprocessAsync(() => Promise.reject(new Error("boom")), string())
    const fromError = await failureAsync(errorReject, "x")
    expect(fromError.output).toBe("x")
    expect(fromError.issues[0]).toMatchObject({
      type: "preprocess",
      message: "Invalid preprocess: boom",
      severity: "error",
      input: "x",
    })

    const stringReject = preprocessAsync(() => Promise.reject("nope"), string())
    const fromString = await failureAsync(stringReject, 1)
    expect(fromString.issues[0]?.message).toBe("Invalid preprocess: nope")
    expect(fromString.output).toBe(1)

    const undefinedReject = preprocessAsync(() => Promise.reject(undefined), string())
    const fromUndefined = await failureAsync(undefinedReject, "keep")
    expect(fromUndefined.issues[0]?.message).toBe("Invalid preprocess: undefined")
    expect(fromUndefined.output).toBe("keep")
  })

  it("records a synchronous throw from an async operation the same way", async () => {
    const thrown = preprocessAsync(async () => {
      throw new Error("boom")
    }, number())
    const fromError = await failureAsync(thrown, "5")
    expect(fromError.output).toBe("5")
    expect(fromError.issues).toHaveLength(1)
    expect(fromError.issues[0]?.message).toBe("Invalid preprocess: boom")

    const thrownString = preprocessAsync(() => {
      throw "nope"
    }, string())
    try {
      await parseAsync(thrownString, 1)
      throw new Error("parseAsync should have thrown")
    } catch (error) {
      expect(isTskmError(error)).toBe(true)
      if (isTskmError(error)) {
        expect(error.issues[0]?.message).toBe("Invalid preprocess: nope")
      }
    }
  })

  it("lets an inner transform rejection propagate unchanged", async () => {
    const inner = new Error("inner boom")
    const schema = preprocessAsync(
      async (value) => value,
      pipeAsync(
        string(),
        transformAsync(async () => {
          throw inner
        }),
      ),
    )
    try {
      await schema["~run"]({ value: "hi" }, {})
      throw new Error("inner rejection should have propagated")
    } catch (error) {
      expect(error).toBe(inner)
    }
    try {
      await parseAsync(schema, "hi")
      throw new Error("parseAsync should have rejected with the inner error")
    } catch (error) {
      expect(error).toBe(inner)
      expect(isTskmError(error)).toBe(false)
    }

    const raw = "inner-raw"
    const rawSchema = preprocessAsync(
      async (value) => value,
      pipeAsync(
        string(),
        transformAsync(async () => Promise.reject(raw)),
      ),
    )
    try {
      await parseAsync(rawSchema, "hi")
      throw new Error("parseAsync should have rejected with the raw reason")
    } catch (error) {
      expect(error).toBe(raw)
    }
  })

  it("skips the inner schema on ctx.issue and still runs it after a warning", async () => {
    const stopped = preprocessAsync(async (_value, ctx) => {
      ctx.issue("stop")
      return 1
    }, number())
    const stoppedResult = await failureAsync(stopped, "5")
    expect(stoppedResult.output).toBe("5")
    expect(stoppedResult.issues).toHaveLength(1)
    expect(stoppedResult.issues[0]?.type).toBe("preprocess")

    const warned = preprocessAsync(async (value, ctx) => {
      ctx.issue("heads up", "warning")
      return Number(value)
    }, number())
    const warnedResult = await safeParseAsync(warned, "8")
    expect(warnedResult.success).toBe(true)
    if (warnedResult.success) {
      expect(warnedResult.output).toBe(8)
      expect(warnedResult.warnings).toHaveLength(1)
    }

    const dataset = { value: "x", typed: true as const }
    const result = await preprocessAsync(async () => {
      throw new Error("boom")
    }, string())["~run"](dataset as never, {})
    expect(result.typed).toBe(false)
    expect(result.value).toBe("x")
  })
})
