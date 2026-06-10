import { describe, expect, it } from "bun:test"
import {
  type Config,
  type GenericSchema,
  number,
  object,
  picklist,
  pipe,
  pipeAsync,
  recordAsync,
  safeParseAsync,
  string,
  templateLiteral,
  transform,
  transformAsync,
} from "../src/index.ts"

/**
 * Async parity for the keyed `record` (issue #19 / contract section 3): `recordAsync` mirrors
 * `record` and awaits async key/value schemas, so a record of async-validated values is usable.
 */
describe("recordAsync runtime (#19 async parity)", () => {
  const asyncUpper = pipeAsync(
    string(),
    transformAsync(async (value: string) => value.toUpperCase()),
  )

  it("recordAsync(value) awaits an async value schema and has no key schema", async () => {
    const r = await safeParseAsync(recordAsync(asyncUpper), { a: "x", b: "y" })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({ a: "X", b: "Y" })
    }
    expect(recordAsync(asyncUpper).key).toBeUndefined()
  })

  it("recordAsync(value, message) keeps the trailing message disambiguation", async () => {
    const r = await safeParseAsync(recordAsync(number(), "nope"), 5)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("nope")
    }
  })

  it("a picklist key rejects an out-of-set key with the key on the path", async () => {
    const r = recordAsync(picklist(["a", "b"]), number())
    expect((await safeParseAsync(r, { a: 1, b: 2 })).success).toBe(true)
    const bad = await safeParseAsync(r, { a: 1, c: 2 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "c" }])
    }
  })

  it("a templateLiteral key constrains the key shape", async () => {
    const r = recordAsync(templateLiteral(["item_", string()]), number())
    expect((await safeParseAsync(r, { item_x: 1 })).success).toBe(true)
    expect((await safeParseAsync(r, { foo: 1 })).success).toBe(false)
    expect(r.key).toBeDefined()
  })

  it("validates async values under a key schema", async () => {
    const r = recordAsync(picklist(["a"]), asyncUpper)
    const ok = await safeParseAsync(r, { a: "hi" })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.output).toEqual({ a: "HI" })
    }
  })

  it("accepts a partial subset of a finite key set", async () => {
    const r = recordAsync(picklist(["a", "b"]), number())
    expect((await safeParseAsync(r, { a: 1 })).success).toBe(true)
    expect((await safeParseAsync(r, {})).success).toBe(true)
  })

  it("writes a `__proto__` key as an own property, never onto the prototype", async () => {
    const input = JSON.parse('{"__proto__": 1, "a": 2}')
    const res = await safeParseAsync(recordAsync(number()), input)
    expect(res.success).toBe(true)
    if (res.success) {
      const desc = Object.getOwnPropertyDescriptor(res.output, "__proto__")
      expect(desc?.value).toBe(1)
      expect(Object.getPrototypeOf(res.output)).toBe(Object.prototype)
    }
  })

  it("rejects a non-object input", async () => {
    expect((await safeParseAsync(recordAsync(number()), 5)).success).toBe(false)
  })
})

describe("recordAsync schema contract", () => {
  it("exposes the public schema fields", () => {
    const schema = recordAsync(picklist(["a"]), number(), "custom")
    expect(schema.kind).toBe("schema")
    expect(schema.type).toBe("record")
    expect(schema.expects).toBe("Object")
    expect(schema.async).toBe(true)
    expect(schema.reference).toBe(recordAsync)
    expect(schema.message).toBe("custom")
  })

  it.each([
    ["a number", 5],
    ["null", null],
    ["an array", [1]],
    ["a string", "x"],
  ])("rejects %s with a structured record type issue", async (_label, input) => {
    const bad = await safeParseAsync(recordAsync(number()), input)
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.kind).toBe("schema")
      expect(bad.issues[0]?.type).toBe("record")
      expect(bad.issues[0]?.expected).toBe("Object")
      expect(bad.issues[0]?.message).toContain("Invalid type")
      expect(bad.issues[0]?.message).toContain("Expected Object")
    }
  })

  it("treats a null message from an untyped caller as an absent message", async () => {
    // A plain-JS caller can pass `null` in the optional message slot; the argument probe
    // must classify it as a non-schema without applying the `in` operator to null.
    const schema = recordAsync(number(), null as unknown as string)
    expect(schema.key).toBeUndefined()
    const bad = await safeParseAsync(schema, 5)
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.message).toContain("Expected Object")
    }
  })
})

describe("recordAsync typed-state propagation", () => {
  const countKeys = transform((value: Record<string, unknown>) => Object.keys(value).length)

  it("keeps a fully valid record typed, so a piped transform runs", async () => {
    const res = await safeParseAsync(pipeAsync(recordAsync(number()), countKeys), { a: 1, b: 2 })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.output).toBe(2)
    }
  })

  it("an invalid value untypes the record, so a piped transform is skipped", async () => {
    const bad = await safeParseAsync(pipeAsync(recordAsync(number()), countKeys), { a: "x" })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.output).toEqual({ a: "x" })
      expect(bad.issues[0]?.path).toEqual([{ key: "a" }])
    }
  })

  it("an invalid key untypes the record, so a piped transform is skipped", async () => {
    const bad = await safeParseAsync(pipeAsync(recordAsync(picklist(["a"]), number()), countKeys), {
      b: 1,
    })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.output).toEqual({ b: 1 })
    }
  })

  it("a warning-only key issue keeps the record typed and the parse successful", async () => {
    const flaggedKey = pipe(
      string(),
      transform((key: string, ctx) => {
        ctx.issue("flagged key", "warning")
        return key
      }),
    )
    const res = await safeParseAsync(pipeAsync(recordAsync(flaggedKey, number()), countKeys), {
      a: 1,
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.output).toBe(1)
      expect(res.warnings).toHaveLength(1)
      expect(res.warnings[0]?.path).toEqual([{ key: "a" }])
    }
  })
})

describe("recordAsync issue collection and abort semantics", () => {
  const rejectConfigs: ReadonlyArray<readonly [string, Config]> = [
    ["abortEarly", { abortEarly: true }],
    ["reject mode", { mode: "reject" }],
  ]

  it("report mode collects one issue per invalid key", async () => {
    const bad = await safeParseAsync(recordAsync(picklist(["a"]), number()), { b: 1, c: 2 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues).toHaveLength(2)
      expect(bad.issues.map((issue) => issue.path)).toEqual([[{ key: "b" }], [{ key: "c" }]])
    }
  })

  it("report mode collects one issue per invalid value", async () => {
    const bad = await safeParseAsync(recordAsync(number()), { a: "x", b: "y" })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues).toHaveLength(2)
      expect(bad.issues.map((issue) => issue.path)).toEqual([[{ key: "a" }], [{ key: "b" }]])
    }
  })

  it.each(
    rejectConfigs,
  )("%s stops at the first invalid key and keeps the input as output", async (_label, config) => {
    const bad = await safeParseAsync(
      recordAsync(picklist(["a"]), number()),
      { b: "x", a: 1 },
      config,
    )
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues).toHaveLength(1)
      expect(bad.issues[0]?.type).toBe("picklist")
      expect(bad.issues[0]?.path).toEqual([{ key: "b" }])
      expect(bad.output).toEqual({ b: "x", a: 1 })
    }
  })

  it.each(
    rejectConfigs,
  )("%s stops at the first invalid value and keeps the input as output", async (_label, config) => {
    const bad = await safeParseAsync(recordAsync(number()), { a: 1, b: "x", c: "y" }, config)
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues).toHaveLength(1)
      expect(bad.issues[0]?.path).toEqual([{ key: "b" }])
      expect(bad.output).toEqual({ a: 1, b: "x", c: "y" })
    }
  })

  it("prepends the record key to a nested value issue path", async () => {
    const bad = await safeParseAsync(recordAsync(object({ n: number() })), { a: { n: "x" } })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "a" }, { key: "n" }])
    }
  })

  it("prepends the offending key to a key issue that already carries a path", async () => {
    const keyBase = string()
    // A key schema may emit an issue that already carries a path; the record must
    // prepend the offending key to that path, not replace it.
    const segmentedKey: GenericSchema<unknown, string> = {
      ...keyBase,
      "~run"(dataset, config) {
        const out = keyBase["~run"](dataset, config)
        if (out.typed && out.value === "bad") {
          return {
            typed: false,
            value: out.value,
            issues: [
              {
                kind: "schema",
                type: "segment",
                expected: '"good"',
                received: '"bad"',
                message: "Invalid segment",
                input: out.value,
                path: [{ key: "segment" }],
              },
            ],
          }
        }
        return out
      },
    }
    const bad = await safeParseAsync(recordAsync(segmentedKey, number()), { bad: 1 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "bad" }, { key: "segment" }])
    }
  })
})
