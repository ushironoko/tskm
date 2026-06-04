import { describe, expect, it } from "bun:test"
import {
  any,
  array,
  arrayAsync,
  bigint,
  boolean,
  date,
  type GenericSchema,
  type GenericSchemaAsync,
  lazy,
  literal,
  never_,
  null_,
  nullable,
  nullish,
  number,
  object,
  objectAsync,
  optional,
  picklist,
  record,
  recursive,
  string,
  tuple,
  undefined_,
  union,
  unionAsync,
  unknown,
} from "../src/index.ts"

// The `~standard` getter (Standard Schema entry point) is invoked only when a consumer
// reads `schema["~standard"]` — `parse`/`safeParse` go straight to `~run` and never touch
// it. These cases drive every schema through the public Standard Schema interface so the
// getter and its `validate` delegate are exercised for each kind.

interface SyncCase {
  readonly name: string
  readonly schema: GenericSchema
  readonly valid?: unknown
  readonly invalid?: unknown
}

const syncCases: ReadonlyArray<SyncCase> = [
  { name: "string", schema: string(), valid: "x", invalid: 1 },
  { name: "number", schema: number(), valid: 1, invalid: "x" },
  { name: "boolean", schema: boolean(), valid: true, invalid: 1 },
  { name: "bigint", schema: bigint(), valid: 1n, invalid: 1 },
  { name: "date", schema: date(), valid: new Date(0), invalid: "x" },
  { name: "literal", schema: literal("a"), valid: "a", invalid: "b" },
  { name: "picklist", schema: picklist(["a", "b"]), valid: "a", invalid: "c" },
  { name: "null_", schema: null_(), valid: null, invalid: 1 },
  { name: "undefined_", schema: undefined_(), valid: undefined, invalid: 1 },
  { name: "any", schema: any(), valid: { whatever: true } },
  { name: "unknown", schema: unknown(), valid: Symbol("ok") },
  { name: "never_", schema: never_(), invalid: 1 },
  { name: "nullable", schema: nullable(string()), valid: null, invalid: 1 },
  { name: "nullish", schema: nullish(string()), valid: undefined, invalid: 1 },
  { name: "optional", schema: optional(string()), valid: undefined, invalid: 1 },
  { name: "array", schema: array(string()), valid: ["x"], invalid: [1] },
  { name: "record", schema: record(number()), valid: { a: 1 }, invalid: { a: "x" } },
  { name: "tuple", schema: tuple([string()]), valid: ["x"], invalid: [1] },
  { name: "object", schema: object({ a: string() }), valid: { a: "x" }, invalid: { a: 1 } },
  { name: "union", schema: union([string(), number()]), valid: "x", invalid: true },
  { name: "lazy", schema: lazy(() => string()), valid: "x", invalid: 1 },
  // recursive() builds its body lazily and exposes `~standard` via the same getter
  // (recursive.ts L64-65); driving it through Standard Schema forces that accessor
  // and proves the self-referential body validates a nested cycle and rejects a
  // non-object. `{ next: undefined }` is the base case; `1` is not an object.
  {
    name: "recursive",
    schema: recursive((self) => object({ next: optional(self) })),
    valid: { next: { next: undefined } },
    invalid: 1,
  },
]

describe("Standard Schema interface — sync schemas", () => {
  for (const c of syncCases) {
    it(`${c.name} exposes version/vendor and validates synchronously`, () => {
      const std = c.schema["~standard"]
      expect(std.version).toBe(1)
      expect(std.vendor).toBe("tskm")

      if ("valid" in c) {
        const ok = std.validate(c.valid)
        expect(ok).not.toBeInstanceOf(Promise)
        if (!(ok instanceof Promise)) {
          expect("issues" in ok && ok.issues !== undefined).toBe(false)
        }
      }

      if ("invalid" in c) {
        const bad = std.validate(c.invalid)
        expect(bad).not.toBeInstanceOf(Promise)
        if (!(bad instanceof Promise)) {
          expect("issues" in bad && Array.isArray(bad.issues)).toBe(true)
        }
      }
    })
  }
})

interface AsyncCase {
  readonly name: string
  readonly schema: GenericSchemaAsync
  readonly valid: unknown
  readonly invalid: unknown
}

const asyncCases: ReadonlyArray<AsyncCase> = [
  { name: "arrayAsync", schema: arrayAsync(string()), valid: ["x"], invalid: [1] },
  {
    name: "objectAsync",
    schema: objectAsync({ a: string() }),
    valid: { a: "x" },
    invalid: { a: 1 },
  },
  { name: "unionAsync", schema: unionAsync([string(), number()]), valid: "x", invalid: true },
]

describe("Standard Schema interface — async schemas", () => {
  for (const c of asyncCases) {
    it(`${c.name} validates to a Promise resolving to the right result`, async () => {
      const std = c.schema["~standard"]
      expect(std.version).toBe(1)
      expect(std.vendor).toBe("tskm")

      const pending = std.validate(c.valid)
      expect(pending).toBeInstanceOf(Promise)
      const ok = await pending
      expect("issues" in ok && ok.issues !== undefined).toBe(false)

      const bad = await std.validate(c.invalid)
      expect("issues" in bad && Array.isArray(bad.issues)).toBe(true)
    })
  }
})
