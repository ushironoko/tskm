import { describe, expect, it } from "bun:test"
import {
  type Config,
  type GenericSchema,
  number,
  object,
  picklist,
  pipe,
  record,
  regex,
  safeParse,
  string,
  templateLiteral,
  transform,
} from "../src/index.ts"

/**
 * Key schema argument to `record` (issue #19): `record(key, value)` validates each key
 * through the key schema. `record(value)` is unchanged.
 */
describe("keyed record runtime (#19)", () => {
  it("record(value) is unchanged and has no key schema", () => {
    expect(safeParse(record(number()), { a: 1 }).success).toBe(true)
    expect(safeParse(record(number()), { a: "x" }).success).toBe(false)
    expect(record(number()).key).toBeUndefined()
  })

  it("record(value, message) keeps the trailing message disambiguation", () => {
    const r = safeParse(record(number(), "nope"), 5)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("nope")
    }
  })

  it("a picklist key rejects an out-of-set key with the key on the path", () => {
    const r = record(picklist(["a", "b"]), number())
    expect(safeParse(r, { a: 1, b: 2 }).success).toBe(true)
    const bad = safeParse(r, { a: 1, c: 2 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "c" }])
    }
  })

  it("a templateLiteral key constrains the key shape", () => {
    const r = record(templateLiteral(["item_", string()]), number())
    expect(safeParse(r, { item_x: 1, item_y: 2 }).success).toBe(true)
    expect(safeParse(r, { foo: 1 }).success).toBe(false)
    expect(r.key).toBeDefined()
  })

  it("still validates values under a key schema", () => {
    const r = record(picklist(["a"]), number())
    expect(safeParse(r, { a: "not a number" }).success).toBe(false)
  })

  it("accepts a partial subset of a finite key set (a record may omit keys)", () => {
    const r = record(picklist(["a", "b"]), number())
    expect(safeParse(r, { a: 1 }).success).toBe(true)
    expect(safeParse(r, {}).success).toBe(true)
  })

  it("a regex-piped string key enforces the pattern at RUNTIME (the TS key type stays `string`)", () => {
    // A `regex`-piped string outputs `string`, so TypeScript cannot express the pattern: the
    // inferred key type is `string` and the emitted type is an unconstrained index signature.
    // The constraint lives at runtime (here) and in JSON Schema (`propertyNames.pattern`).
    const r = record(pipe(string(), regex(/^k_/)), number())
    expect(safeParse(r, { k_a: 1, k_b: 2 }).success).toBe(true)
    const bad = safeParse(r, { nope: 1 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "nope" }])
    }
  })

  it("writes a `__proto__` key as an own property, never onto the prototype", () => {
    const r = record(number())
    // An own `__proto__` key can only be built via JSON.parse, not an object literal.
    const input = JSON.parse('{"__proto__": 1, "a": 2}')
    const res = safeParse(r, input)
    expect(res.success).toBe(true)
    if (res.success) {
      const desc = Object.getOwnPropertyDescriptor(res.output, "__proto__")
      expect(desc?.value).toBe(1)
      // The output's prototype is intact (the key did not corrupt the [[Prototype]] slot).
      expect(Object.getPrototypeOf(res.output)).toBe(Object.prototype)
    }
  })
})

describe("record schema contract", () => {
  it("exposes the public schema fields", () => {
    const schema = record(picklist(["a"]), number(), "custom")
    expect(schema.kind).toBe("schema")
    expect(schema.type).toBe("record")
    expect(schema.expects).toBe("Object")
    expect(schema.async).toBe(false)
    expect(schema.reference).toBe(record)
    expect(schema.message).toBe("custom")
  })

  it.each([
    ["a number", 5],
    ["null", null],
    ["an array", [1]],
    ["a string", "x"],
  ])("rejects %s with a structured record type issue", (_label, input) => {
    const bad = safeParse(record(number()), input)
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.kind).toBe("schema")
      expect(bad.issues[0]?.type).toBe("record")
      expect(bad.issues[0]?.expected).toBe("Object")
      expect(bad.issues[0]?.message).toContain("Invalid type")
      expect(bad.issues[0]?.message).toContain("Expected Object")
    }
  })

  it("treats a null message from an untyped caller as an absent message", () => {
    // A plain-JS caller can pass `null` in the optional message slot; the argument probe
    // must classify it as a non-schema without applying the `in` operator to null.
    const schema = record(number(), null as unknown as string)
    expect(schema.key).toBeUndefined()
    const bad = safeParse(schema, 5)
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.message).toContain("Expected Object")
    }
  })
})

describe("record typed-state propagation", () => {
  const countKeys = transform((value: Record<string, unknown>) => Object.keys(value).length)

  it("keeps a fully valid record typed, so a piped transform runs", () => {
    const res = safeParse(pipe(record(number()), countKeys), { a: 1, b: 2 })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.output).toBe(2)
    }
  })

  it("an invalid value untypes the record, so a piped transform is skipped", () => {
    const bad = safeParse(pipe(record(number()), countKeys), { a: "x" })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.output).toEqual({ a: "x" })
      expect(bad.issues[0]?.path).toEqual([{ key: "a" }])
    }
  })

  it("an invalid key untypes the record, so a piped transform is skipped", () => {
    const bad = safeParse(pipe(record(picklist(["a"]), number()), countKeys), { b: 1 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.output).toEqual({ b: 1 })
    }
  })

  it("a warning-only key issue keeps the record typed and the parse successful", () => {
    const flaggedKey = pipe(
      string(),
      transform((key: string, ctx) => {
        ctx.issue("flagged key", "warning")
        return key
      }),
    )
    const res = safeParse(pipe(record(flaggedKey, number()), countKeys), { a: 1 })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.output).toBe(1)
      expect(res.warnings).toHaveLength(1)
      expect(res.warnings[0]?.path).toEqual([{ key: "a" }])
    }
  })
})

describe("record issue collection and abort semantics", () => {
  const rejectConfigs: ReadonlyArray<readonly [string, Config]> = [
    ["abortEarly", { abortEarly: true }],
    ["reject mode", { mode: "reject" }],
  ]

  it("report mode collects one issue per invalid key", () => {
    const bad = safeParse(record(picklist(["a"]), number()), { b: 1, c: 2 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues).toHaveLength(2)
      expect(bad.issues.map((issue) => issue.path)).toEqual([[{ key: "b" }], [{ key: "c" }]])
    }
  })

  it.each(
    rejectConfigs,
  )("%s stops at the first invalid key and keeps the input as output", (_label, config) => {
    const bad = safeParse(record(picklist(["a"]), number()), { b: "x", a: 1 }, config)
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
  )("%s stops at the first invalid value and keeps the input as output", (_label, config) => {
    const bad = safeParse(record(number()), { a: 1, b: "x", c: "y" }, config)
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues).toHaveLength(1)
      expect(bad.issues[0]?.path).toEqual([{ key: "b" }])
      expect(bad.output).toEqual({ a: 1, b: "x", c: "y" })
    }
  })

  it("prepends the record key to a nested value issue path", () => {
    const bad = safeParse(record(object({ n: number() })), { a: { n: "x" } })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "a" }, { key: "n" }])
    }
  })

  it("prepends the offending key to a key issue that already carries a path", () => {
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
    const bad = safeParse(record(segmentedKey, number()), { bad: 1 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "bad" }, { key: "segment" }])
    }
  })
})
