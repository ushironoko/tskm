import { describe, expect, it } from "bun:test"
import {
  getDotPath,
  isTskmError,
  minLength,
  number,
  object,
  parse,
  pipe,
  safeParse,
  string,
} from "../src/index.ts"

describe("basic schemas", () => {
  it("parses valid input and rejects invalid", () => {
    expect(parse(string(), "hi")).toBe("hi")
    expect(() => parse(string(), 123)).toThrow()
    const r = safeParse(number(), "nope")
    expect(r.success).toBe(false)
  })
})

describe("R1: PartialDataset (typed but with refinement issues) is a FAILURE", () => {
  const schema = pipe(string(), minLength(5))

  it("safeParse reports failure", () => {
    const r = safeParse(schema, "ab")
    expect(r.success).toBe(false)
  })

  it("~standard.validate reports failure (issues present), not success", () => {
    const result = schema["~standard"].validate("ab")
    expect("issues" in result && result.issues !== undefined).toBe(true)
  })
})

describe("R8: piped schema's ~standard derives from the piped run", () => {
  it("validate fails using the pipe, not the bare string", () => {
    const schema = pipe(string(), minLength(5))
    const result = schema["~standard"].validate("ab")
    expect("issues" in result && Array.isArray(result.issues)).toBe(true)
    // the bare string alone would accept "ab"
    expect(string()["~standard"].validate("ab")).toEqual({ value: "ab" })
  })
})

describe("R2: object issue paths use { key } segments and nest", () => {
  const schema = object({ user: object({ name: string() }) })

  it("nested failure path is [{key:'user'},{key:'name'}]", () => {
    const r = safeParse(schema, { user: { name: 123 } })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: "user" }, { key: "name" }])
      expect(getDotPath(issue as never)).toBe("user.name")
    }
  })
})

describe("R9: object run does not mutate the input", () => {
  it("returns a fresh object and leaves input untouched", () => {
    const schema = object({ name: string(), age: number() })
    const input = { name: "a", age: 1 }
    const out = parse(schema, input)
    expect(out).not.toBe(input)
    expect(input).toEqual({ name: "a", age: 1 })
  })
})

describe("Standard Schema shape", () => {
  it("exposes version/vendor and accepts an options arg", () => {
    const s = string()
    expect(s["~standard"].version).toBe(1)
    expect(s["~standard"].vendor).toBe("tskm")
    expect(s["~standard"].validate.length).toBeGreaterThanOrEqual(1)
    expect(s["~standard"].validate("x", { libraryOptions: {} })).toEqual({ value: "x" })
  })
})

describe("errors", () => {
  it("tskmError is a real Error and isTskmError recognizes it by shape", () => {
    try {
      parse(string(), 1)
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect(isTskmError(e)).toBe(true)
      // duck-typed: a plain shaped object is NOT one, but a copied-shape Error is
      const fake = Object.assign(new Error("x"), { name: "TskmError", issues: [] })
      expect(isTskmError(fake)).toBe(true)
    }
  })
})
