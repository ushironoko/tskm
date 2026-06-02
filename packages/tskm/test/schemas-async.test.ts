import { describe, expect, it } from "bun:test"
import {
  arrayAsync,
  getDotPath,
  number,
  objectAsync,
  optional,
  parseAsync,
  safeParseAsync,
  string,
} from "../src/index.ts"

describe("arrayAsync", () => {
  it("resolves to success for a valid array and yields a fresh output array", async () => {
    const schema = arrayAsync(string())
    const input = ["a", "b"]
    const r = await safeParseAsync(schema, input)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual(["a", "b"])
      // never mutate the user's input
      expect(r.output).not.toBe(input)
    }
  })

  it("parseAsync returns the typed output for a valid array", async () => {
    const out = await parseAsync(arrayAsync(string()), ["x", "y", "z"])
    expect(out).toEqual(["x", "y", "z"])
  })

  it("resolves to failure with a nested element path for an invalid element", async () => {
    const r = await safeParseAsync(arrayAsync(string()), ["ok", 123])
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: 1 }])
      expect(getDotPath(issue as never)).toBe("1")
    }
  })

  it("parseAsync throws for an invalid element", async () => {
    let threw = false
    try {
      await parseAsync(arrayAsync(string()), [42])
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  it("rejects a non-array input with a schema-kind array issue", async () => {
    const r = await safeParseAsync(arrayAsync(string()), "not-an-array")
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.kind).toBe("schema")
      expect(issue?.type).toBe("array")
      expect(issue?.expected).toBe("Array")
      expect(issue?.path).toBeUndefined()
    }
  })

  it("uses a custom message for non-array input when provided", async () => {
    const r = await safeParseAsync(arrayAsync(string(), "must be a list"), 5)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("must be a list")
    }
  })

  it("collects every element issue without abortEarly (default config)", async () => {
    const r = await safeParseAsync(arrayAsync(string()), [1, 2, 3])
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(3)
      expect(r.issues.map((i) => i.path?.[0]?.key)).toEqual([0, 1, 2])
    }
  })

  it("stops at the first element issue when abortEarly is set", async () => {
    const r = await safeParseAsync(arrayAsync(string()), [1, 2, 3], { abortEarly: true })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.path).toEqual([{ key: 0 }])
    }
  })

  it("prepends the index head to an already-nested child issue path", async () => {
    const schema = arrayAsync(objectAsync({ name: string() }))
    const r = await safeParseAsync(schema, [{ name: 1 }])
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: 0 }, { key: "name" }])
      expect(getDotPath(issue as never)).toBe("0.name")
    }
  })

  it("handles an empty array as success", async () => {
    const r = await safeParseAsync(arrayAsync(string()), [])
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual([])
    }
  })
})

describe("objectAsync", () => {
  const schema = objectAsync({ id: number(), name: string() })

  it("resolves to success for a valid object and yields a fresh output object", async () => {
    const input = { id: 1, name: "a" }
    const r = await safeParseAsync(schema, input)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({ id: 1, name: "a" })
      expect(r.output).not.toBe(input)
    }
  })

  it("parseAsync returns the typed output for a valid object", async () => {
    const out = await parseAsync(schema, { id: 7, name: "z" })
    expect(out).toEqual({ id: 7, name: "z" })
  })

  it("resolves to failure with a nested property path for an invalid property", async () => {
    const r = await safeParseAsync(schema, { id: "nope", name: "a" })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: "id" }])
      expect(getDotPath(issue as never)).toBe("id")
    }
  })

  it("parseAsync throws for an invalid property", async () => {
    let threw = false
    try {
      await parseAsync(schema, { id: 1, name: 2 })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  it("rejects null with a schema-kind object issue", async () => {
    const r = await safeParseAsync(schema, null)
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.kind).toBe("schema")
      expect(issue?.type).toBe("object")
      expect(issue?.expected).toBe("Object")
    }
  })

  it("rejects an array with a schema-kind object issue", async () => {
    const r = await safeParseAsync(schema, [1, 2])
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("object")
    }
  })

  it("rejects a non-object primitive input", async () => {
    const r = await safeParseAsync(schema, 123)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.expected).toBe("Object")
    }
  })

  it("uses a custom message for non-object input when provided", async () => {
    const withMessage = objectAsync({ id: number() }, "must be an object")
    const r = await safeParseAsync(withMessage, "nope")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("must be an object")
    }
  })

  it("collects issues from multiple properties without abortEarly", async () => {
    const r = await safeParseAsync(schema, { id: "x", name: 9 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(2)
      const keys = r.issues.map((i) => i.path?.[0]?.key)
      expect(keys).toEqual(expect.arrayContaining(["id", "name"]))
    }
  })

  it("stops at the first property issue when abortEarly is set", async () => {
    const r = await safeParseAsync(schema, { id: "x", name: 9 }, { abortEarly: true })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
    }
  })

  it("treats a missing optional key as valid via its default branch", async () => {
    const withOptional = objectAsync({
      id: number(),
      nick: optional(string(), "anon"),
    })
    const r = await safeParseAsync(withOptional, { id: 1 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({ id: 1, nick: "anon" })
    }
  })

  it("passes through a present optional key", async () => {
    const withOptional = objectAsync({ id: number(), nick: optional(string()) })
    const r = await safeParseAsync(withOptional, { id: 1, nick: "bob" })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({ id: 1, nick: "bob" })
    }
  })

  it("handles an empty entries object as success for any object input", async () => {
    const r = await safeParseAsync(objectAsync({}), { extra: true })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({})
    }
  })
})

describe("async member combinations", () => {
  it("objectAsync containing arrayAsync builds a deeply nested issue path", async () => {
    const schema = objectAsync({
      id: number(),
      tags: arrayAsync(string()),
    })
    const r = await safeParseAsync(schema, { id: 1, tags: ["a", 2] })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: "tags" }, { key: 1 }])
      expect(getDotPath(issue as never)).toBe("tags.1")
    }
  })

  it("objectAsync containing arrayAsync(objectAsync) nests three levels deep", async () => {
    const schema = objectAsync({
      users: arrayAsync(objectAsync({ name: string() })),
    })
    const r = await safeParseAsync(schema, { users: [{ name: "ok" }, { name: 99 }] })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: "users" }, { key: 1 }, { key: "name" }])
      expect(getDotPath(issue as never)).toBe("users.1.name")
    }
  })

  it("the fully-valid nested combination resolves to success", async () => {
    const schema = objectAsync({
      users: arrayAsync(objectAsync({ name: string() })),
    })
    const r = await safeParseAsync(schema, { users: [{ name: "a" }, { name: "b" }] })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({ users: [{ name: "a" }, { name: "b" }] })
    }
  })
})

describe('"~standard".validate returns a Promise for async schemas', () => {
  it("arrayAsync validate resolves to a value result on success", async () => {
    const schema = arrayAsync(string())
    const result = schema["~standard"].validate(["a"])
    expect(result).toBeInstanceOf(Promise)
    const resolved = await result
    expect("value" in resolved && resolved.value).toEqual(["a"])
  })

  it("arrayAsync validate resolves to an issues result on failure", async () => {
    const result = arrayAsync(string())["~standard"].validate([1])
    expect(result).toBeInstanceOf(Promise)
    const resolved = await result
    expect("issues" in resolved && Array.isArray(resolved.issues)).toBe(true)
  })

  it("objectAsync validate resolves to a value result on success", async () => {
    const schema = objectAsync({ id: number() })
    const result = schema["~standard"].validate({ id: 1 })
    expect(result).toBeInstanceOf(Promise)
    const resolved = await result
    expect("value" in resolved && resolved.value).toEqual({ id: 1 })
  })

  it("objectAsync validate resolves to an issues result with lean { message, path } issues", async () => {
    const schema = objectAsync({ id: number() })
    const result = schema["~standard"].validate({ id: "x" })
    expect(result).toBeInstanceOf(Promise)
    const resolved = await result
    if ("issues" in resolved && resolved.issues) {
      expect(resolved.issues[0]?.path).toEqual([{ key: "id" }])
      expect(typeof resolved.issues[0]?.message).toBe("string")
    }
  })

  it("exposes the Standard Schema version and vendor", () => {
    const schema = objectAsync({ id: number() })
    expect(schema["~standard"].version).toBe(1)
    expect(schema["~standard"].vendor).toBe("tskm")
  })
})
