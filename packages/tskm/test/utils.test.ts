import { describe, expect, it } from "bun:test"
import {
  array,
  check,
  flatten,
  getDotPath,
  number,
  object,
  pipe,
  safeParse,
  string,
} from "../src/index.ts"
import { defaultConfig } from "../src/types/config.ts"
import type { UnknownDataset } from "../src/types/dataset.ts"
import type { IssuePathItem } from "../src/types/issue.ts"
import { _addIssue } from "../src/utils/_addIssue.ts"
import { _getStandardProps } from "../src/utils/_getStandardProps.ts"
import { _received } from "../src/utils/_received.ts"

describe("flatten", () => {
  it("buckets nested object issues by dot-path", () => {
    const schema = object({ user: object({ name: string(), age: number() }) })
    const r = safeParse(schema, { user: { name: 123, age: "x" } })
    expect(r.success).toBe(false)
    if (!r.success) {
      const flat = flatten(r.issues)
      expect(flat.root).toEqual([])
      expect(Object.keys(flat.nested).sort()).toEqual(["user.age", "user.name"])
      expect(flat.nested["user.name"]).toHaveLength(1)
      expect(flat.nested["user.age"]).toHaveLength(1)
    }
  })

  it("puts a root (no-path) issue into the root bucket", () => {
    const schema = pipe(
      string(),
      check((v: string) => v.length > 3, "too short"),
    )
    const r = safeParse(schema, "ab")
    expect(r.success).toBe(false)
    if (!r.success) {
      const flat = flatten(r.issues)
      expect(flat.root).toEqual(["too short"])
      expect(flat.nested).toEqual({})
    }
  })

  it("groups multiple issues sharing the same dot-path into one bucket", () => {
    // Two refinements on the same object field accumulate under one path.
    const schema = object({
      name: pipe(
        string(),
        check((v: string) => v.length > 2, "min"),
        check((v: string) => v.startsWith("a"), "prefix"),
      ),
    })
    const r = safeParse(schema, { name: "z" })
    expect(r.success).toBe(false)
    if (!r.success) {
      const flat = flatten(r.issues)
      expect(flat.root).toEqual([])
      expect(flat.nested.name).toEqual(["min", "prefix"])
    }
  })

  it("mixes a root issue and nested issues from an array element", () => {
    const schema = array(string())
    const r = safeParse(schema, ["ok", 5])
    expect(r.success).toBe(false)
    if (!r.success) {
      const flat = flatten(r.issues)
      expect(flat.root).toEqual([])
      expect(Object.keys(flat.nested)).toEqual(["1"])
    }
  })

  it("returns empty buckets for no issues", () => {
    expect(flatten([])).toEqual({ root: [], nested: {} })
  })
})

describe("getDotPath", () => {
  it("joins object segments with dots", () => {
    const schema = object({ a: object({ b: string() }) })
    const r = safeParse(schema, { a: { b: 1 } })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue).toBeDefined()
      expect(getDotPath(issue as never)).toBe("a.b")
    }
  })

  it("returns null when an issue has no path", () => {
    const schema = pipe(
      string(),
      check(() => false, "nope"),
    )
    const r = safeParse(schema, "anything")
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toBeUndefined()
      expect(getDotPath(issue as never)).toBe(null)
    }
  })

  it("renders array index segments numerically and joins with parent keys", () => {
    const schema = object({ items: array(string()) })
    const r = safeParse(schema, { items: ["ok", 5] })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.path).toEqual([{ key: "items" }, { key: 1 }])
      expect(getDotPath(issue as never)).toBe("items.1")
    }
  })

  it("returns null for an empty-string-keyed... bare PropertyKey path form", () => {
    // The Standard spec allows bare PropertyKey segments (not just { key }).
    expect(getDotPath({ message: "m", path: ["a", 0, "b"] })).toBe("a.0.b")
  })

  it("returns null when a path segment is a symbol", () => {
    const sym = Symbol("s")
    expect(getDotPath({ message: "m", path: [{ key: sym }] })).toBe(null)
  })

  it("returns null when a bare symbol segment appears", () => {
    expect(getDotPath({ message: "m", path: [Symbol("x")] })).toBe(null)
  })

  it("returns an empty string for an empty path array", () => {
    expect(getDotPath({ message: "m", path: [] })).toBe("")
  })
})

describe("_received", () => {
  it("formats null and undefined", () => {
    expect(_received(null)).toBe("null")
    expect(_received(undefined)).toBe("undefined")
  })

  it("quotes strings", () => {
    expect(_received("hi")).toBe('"hi"')
  })

  it("stringifies numbers and booleans", () => {
    expect(_received(42)).toBe("42")
    expect(_received(true)).toBe("true")
    expect(_received(false)).toBe("false")
  })

  it("suffixes bigint with n", () => {
    expect(_received(10n)).toBe("10n")
  })

  it("renders symbol via toString", () => {
    expect(_received(Symbol("tag"))).toBe("Symbol(tag)")
  })

  it("labels functions", () => {
    expect(_received(() => 1)).toBe("Function")
  })

  it("labels arrays", () => {
    expect(_received([1, 2])).toBe("Array")
  })

  it("labels Date", () => {
    expect(_received(new Date())).toBe("Date")
  })

  it("labels plain objects", () => {
    expect(_received({ a: 1 })).toBe("Object")
  })
})

describe("_addIssue", () => {
  it("appends a schema-kind issue and marks the dataset untyped", () => {
    const dataset: UnknownDataset = { value: 123 }
    _addIssue(dataset, { kind: "schema", type: "string", expected: "string" }, defaultConfig)
    const mutated = dataset as unknown as {
      typed?: boolean
      issues?: { message: string; received: string; kind: string }[]
    }
    expect(mutated.typed).toBe(false)
    expect(mutated.issues).toHaveLength(1)
    const issue = mutated.issues?.[0]
    expect(issue?.received).toBe("123")
    expect(issue?.message).toBe("Invalid type: Expected string but received 123")
  })

  it("uses info.type (not 'type') in the message for non-schema kinds", () => {
    const dataset: UnknownDataset = { value: "x" }
    _addIssue(dataset, { kind: "validation", type: "min_length", expected: ">=5" }, defaultConfig)
    const mutated = dataset as unknown as {
      typed?: boolean
      issues?: { message: string }[]
    }
    // validation-kind does NOT flip typed.
    expect(mutated.typed).toBeUndefined()
    expect(mutated.issues?.[0]?.message).toBe('Invalid min_length: Expected >=5 but received "x"')
  })

  it("a schema-kind WARNING is appended but does NOT mark the dataset untyped", () => {
    // Only an error-severity schema issue untypes the dataset; a `"warning"` is reported but
    // the value stays well-typed (issue #21, fail-closed default is error).
    const dataset: UnknownDataset = { value: 123 }
    _addIssue(
      dataset,
      { kind: "schema", type: "string", expected: "string", severity: "warning" },
      defaultConfig,
    )
    const mutated = dataset as unknown as { typed?: boolean; issues?: { severity?: string }[] }
    expect(mutated.typed).toBeUndefined()
    expect(mutated.issues).toHaveLength(1)
    expect(mutated.issues?.[0]?.severity).toBe("warning")
  })

  it("builds the 'Received' form when expected is null", () => {
    const dataset: UnknownDataset = { value: null }
    _addIssue(dataset, { kind: "validation", type: "check", expected: null }, defaultConfig)
    const mutated = dataset as unknown as { issues?: { message: string }[] }
    expect(mutated.issues?.[0]?.message).toBe("Invalid check: Received null")
  })

  it("prefers an explicit message over the generated one", () => {
    const dataset: UnknownDataset = { value: 1 }
    _addIssue(
      dataset,
      { kind: "validation", type: "check", expected: null, message: "custom!" },
      defaultConfig,
    )
    const mutated = dataset as unknown as { issues?: { message: string }[] }
    expect(mutated.issues?.[0]?.message).toBe("custom!")
  })

  it("pushes onto an existing issues array", () => {
    const dataset = { value: 1, issues: [] } as {
      value: unknown
      issues: unknown[]
    }
    _addIssue(
      dataset as never,
      { kind: "validation", type: "check", expected: null },
      defaultConfig,
    )
    _addIssue(
      dataset as never,
      { kind: "validation", type: "check", expected: null },
      defaultConfig,
    )
    expect(dataset.issues).toHaveLength(2)
  })

  it("carries the path through to the issue", () => {
    const dataset: UnknownDataset = { value: 1 }
    const path: IssuePathItem[] = [{ key: "a" }, { key: 0 }]
    _addIssue(dataset, { kind: "schema", type: "number", expected: "number", path }, defaultConfig)
    const mutated = dataset as unknown as {
      issues?: { path?: readonly IssuePathItem[] }[]
    }
    expect(mutated.issues?.[0]?.path).toEqual([{ key: "a" }, { key: 0 }])
  })
})

describe("_getStandardProps", () => {
  it("exposes version/vendor and a validate that succeeds and fails", () => {
    const schema = string()
    const props = _getStandardProps(schema)
    expect(props.version).toBe(1)
    expect(props.vendor).toBe("tskm")
    expect(props.validate("hi")).toEqual({ value: "hi" })
    const failed = props.validate(123)
    expect("issues" in failed).toBe(true)
    if ("issues" in failed) {
      expect(Array.isArray(failed.issues)).toBe(true)
    }
  })

  it("memoizes per schema (same props object) and differs across schemas", () => {
    const schema = number()
    const a = _getStandardProps(schema)
    const b = _getStandardProps(schema)
    expect(a).toBe(b)
    expect(_getStandardProps(string())).not.toBe(a)
  })

  it("maps an issue's path through to the Standard issue shape", () => {
    const schema = object({ a: string() })
    const props = _getStandardProps(schema)
    const result = props.validate({ a: 1 })
    expect("issues" in result).toBe(true)
    if ("issues" in result && result.issues) {
      const issue = result.issues[0]
      expect(issue?.path).toEqual([{ key: "a" }])
    }
  })

  it("omits path on a root-level issue", () => {
    const schema = string()
    const props = _getStandardProps(schema)
    const result = props.validate(5)
    if ("issues" in result && result.issues) {
      const issue = result.issues[0]
      expect(issue?.path).toBeUndefined()
    }
  })

  it("resolves a Promise for an async schema run", async () => {
    // A fake async schema whose ~run returns a Promise, to hit the Promise branch.
    const asyncSchema = {
      kind: "schema" as const,
      type: "fake_async",
      reference: () => undefined,
      expects: "fake",
      async: true as const,
      "~run"() {
        return Promise.resolve({ typed: true as const, value: "done" })
      },
      get "~standard"() {
        return _getStandardProps(this as never)
      },
    }
    const props = _getStandardProps(asyncSchema as never)
    const result = await props.validate("anything")
    expect(result).toEqual({ value: "done" })
  })

  it("resolves a Promise to a failure result for an async run with issues", async () => {
    const asyncSchema = {
      kind: "schema" as const,
      type: "fake_async_fail",
      reference: () => undefined,
      expects: "fake",
      async: true as const,
      "~run"() {
        return Promise.resolve({
          typed: false as const,
          value: 0,
          issues: [{ message: "bad", path: [{ key: "x" }] }],
        })
      },
    }
    const props = _getStandardProps(asyncSchema as never)
    const result = await props.validate("anything")
    expect("issues" in result).toBe(true)
    if ("issues" in result && result.issues) {
      expect(result.issues[0]?.message).toBe("bad")
      expect(result.issues[0]?.path).toEqual([{ key: "x" }])
    }
  })
})
