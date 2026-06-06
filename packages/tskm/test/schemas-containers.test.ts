import { describe, expect, it } from "bun:test"
import {
  array,
  getDotPath,
  number,
  object,
  optional,
  parse,
  record,
  safeParse,
  string,
  tuple,
  union,
} from "../src/index.ts"

describe("array", () => {
  it("accepts a valid array of strings and returns a fresh array", () => {
    const schema = array(string())
    const input = ["a", "b"]
    const out = parse(schema, input)
    expect(out).toEqual(["a", "b"])
    expect(out).not.toBe(input)
  })

  it("accepts an empty array", () => {
    expect(parse(array(string()), [])).toEqual([])
  })

  it("rejects a bad element and the issue path includes the index", () => {
    const schema = array(string())
    const r = safeParse(schema, ["ok", 123])
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: 1 }])
      expect(getDotPath(issue as never)).toBe("1")
    }
  })

  it("nests issue path through array of objects", () => {
    const schema = array(object({ name: string() }))
    const r = safeParse(schema, [{ name: "a" }, { name: 9 }])
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: 1 }, { key: "name" }])
      expect(getDotPath(issue as never)).toBe("1.name")
    }
  })

  it("rejects a non-array with an array schema issue", () => {
    const r = safeParse(array(string()), "not-an-array")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("array")
      expect(r.issues[0]?.expected).toBe("Array")
    }
  })

  it("respects a custom message on the top-level array issue", () => {
    const r = safeParse(array(string(), "needs array"), 5)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("needs array")
    }
  })

  it("abortEarly stops after the first bad element", () => {
    const r = safeParse(array(string()), [1, 2, 3], { abortEarly: true })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.path).toEqual([{ key: 0 }])
    }
  })

  it("collects every bad element without abortEarly", () => {
    const r = safeParse(array(string()), [1, "ok", 2])
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(2)
      expect(r.issues[0]?.path).toEqual([{ key: 0 }])
      expect(r.issues[1]?.path).toEqual([{ key: 2 }])
    }
  })
})

describe("record", () => {
  it("accepts a valid record of numbers and returns a fresh object", () => {
    const schema = record(number())
    const input = { a: 1, b: 2 }
    const out = parse(schema, input)
    expect(out).toEqual({ a: 1, b: 2 })
    expect(out).not.toBe(input)
  })

  it("accepts an empty object", () => {
    expect(parse(record(number()), {})).toEqual({})
  })

  it("rejects a bad value and the issue path includes the key", () => {
    const r = safeParse(record(number()), { a: 1, b: "nope" })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: "b" }])
      expect(getDotPath(issue as never)).toBe("b")
    }
  })

  it("rejects null with a record schema issue", () => {
    const r = safeParse(record(number()), null)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("record")
      expect(r.issues[0]?.expected).toBe("Object")
    }
  })

  it("rejects an array (arrays are not records)", () => {
    const r = safeParse(record(number()), [1, 2])
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("record")
    }
  })

  it("respects a custom message on the top-level record issue", () => {
    const r = safeParse(record(number(), "needs object"), 42)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("needs object")
    }
  })

  it("abortEarly stops after the first bad value", () => {
    const r = safeParse(record(number()), { a: "x", b: "y" }, { abortEarly: true })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
    }
  })

  it("without abortEarly accumulates one issue per invalid value", () => {
    // Two bad values: the first seeds dataset.issues, the second must be appended to the
    // existing array (not replace it), so both keys are reported with their own path.
    const r = safeParse(record(number()), { a: "x", b: "y" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(2)
      expect(r.issues.map((i) => i.path?.[0])).toEqual([{ key: "a" }, { key: "b" }])
    }
  })
})

describe("tuple", () => {
  it("accepts a correctly-shaped tuple and returns a fresh array", () => {
    const schema = tuple([string(), number()])
    const input: [string, number] = ["a", 1]
    const out = parse(schema, input)
    expect(out).toEqual(["a", 1])
    expect(out).not.toBe(input)
  })

  it("rejects wrong arity (too few)", () => {
    const r = safeParse(tuple([string(), number()]), ["a"])
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("tuple")
      expect(r.issues[0]?.expected).toBe("Array")
    }
  })

  it("rejects wrong arity (too many)", () => {
    const r = safeParse(tuple([string(), number()]), ["a", 1, 2])
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("tuple")
    }
  })

  it("rejects a wrong element type and the issue path includes the index", () => {
    const r = safeParse(tuple([string(), number()]), ["a", "b"])
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: 1 }])
      expect(getDotPath(issue as never)).toBe("1")
    }
  })

  it("nests issue path through a tuple of objects", () => {
    const r = safeParse(tuple([object({ name: string() })]), [{ name: 5 }])
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.path).toEqual([{ key: 0 }, { key: "name" }])
      expect(getDotPath(r.issues[0] as never)).toBe("0.name")
    }
  })

  it("rejects a non-array with a tuple schema issue", () => {
    const r = safeParse(tuple([string()]), "x")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("tuple")
    }
  })

  it("respects a custom message on the top-level tuple issue", () => {
    const r = safeParse(tuple([string()], "needs pair"), [])
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("needs pair")
    }
  })

  it("abortEarly stops after the first bad element", () => {
    const r = safeParse(tuple([number(), number()]), ["a", "b"], { abortEarly: true })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.path).toEqual([{ key: 0 }])
    }
  })

  it("without abortEarly accumulates one issue per invalid element", () => {
    // Both elements fail: the second issue must be pushed onto the array seeded by the
    // first, so every offending index is reported rather than just the earliest.
    const r = safeParse(tuple([number(), number()]), ["a", "b"])
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(2)
      expect(r.issues.map((i) => i.path?.[0])).toEqual([{ key: 0 }, { key: 1 }])
    }
  })
})

describe("object", () => {
  it("accepts required + optional keys, applying optional default for a missing key", () => {
    const schema = object({ a: string(), b: optional(number(), 0) })
    const out = parse(schema, { a: "x" })
    expect(out).toEqual({ a: "x", b: 0 })
  })

  it("accepts an explicitly provided optional value", () => {
    const schema = object({ a: string(), b: optional(number()) })
    const out = parse(schema, { a: "x", b: 5 })
    expect(out).toEqual({ a: "x", b: 5 })
  })

  it("leaves an optional-without-default key undefined when missing", () => {
    const schema = object({ a: string(), b: optional(number()) })
    const out = parse(schema, { a: "x" })
    expect(out).toEqual({ a: "x", b: undefined })
  })

  it("fails when a required key is missing", () => {
    const r = safeParse(object({ a: string() }), {})
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: "a" }])
      expect(getDotPath(issue as never)).toBe("a")
    }
  })

  it("produces a nested issue path for a nested object", () => {
    const schema = object({ user: object({ name: string() }) })
    const r = safeParse(schema, { user: { name: 1 } })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.path).toEqual([{ key: "user" }, { key: "name" }])
      expect(getDotPath(r.issues[0] as never)).toBe("user.name")
    }
  })

  it("rejects null with an object schema issue", () => {
    const r = safeParse(object({ a: string() }), null)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("object")
      expect(r.issues[0]?.expected).toBe("Object")
    }
  })

  it("throws via parse for a non-object input (null)", () => {
    expect(() => parse(object({ a: string() }), null)).toThrow()
  })

  it("rejects an array with an object schema issue", () => {
    const r = safeParse(object({ a: string() }), [])
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("object")
    }
  })

  it("respects a custom message on the top-level object issue", () => {
    const r = safeParse(object({ a: string() }, "needs object"), 7)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("needs object")
    }
  })

  it("abortEarly stops after the first failing entry", () => {
    const r = safeParse(
      object({ a: string(), b: number() }),
      { a: 1, b: "x" },
      { abortEarly: true },
    )
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
    }
  })

  it("collects multiple failing entries without abortEarly", () => {
    const r = safeParse(object({ a: string(), b: number() }), { a: 1, b: "x" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe("union", () => {
  it("accepts a string member", () => {
    expect(parse(union([string(), number()]), "hi")).toBe("hi")
  })

  it("accepts a number member", () => {
    expect(parse(union([string(), number()]), 42)).toBe(42)
  })

  it("rejects a non-member with a single union issue", () => {
    const r = safeParse(union([string(), number()]), true)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("union")
      expect(r.issues[0]?.expected).toBe("string | number")
    }
  })

  it("respects a custom message on the union issue", () => {
    const r = safeParse(union([string(), number()], "string or number"), {})
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("string or number")
    }
  })

  it("reports the joined expects string in the schema metadata", () => {
    const schema = union([string(), number()])
    expect(schema.expects).toBe("string | number")
  })

  it("works as a nested member with a parent issue path", () => {
    const schema = object({ id: union([string(), number()]) })
    const r = safeParse(schema, { id: false })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.path).toEqual([{ key: "id" }])
      expect(r.issues[0]?.type).toBe("union")
    }
  })
})
