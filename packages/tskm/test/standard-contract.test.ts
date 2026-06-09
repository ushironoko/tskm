import { describe, expect, it } from "bun:test"
import {
  any,
  array,
  arrayAsync,
  bigint,
  boolean,
  date,
  discriminatedUnion,
  discriminatedUnionAsync,
  exactObject,
  exactObjectAsync,
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
  recordAsync,
  recursive,
  string,
  templateLiteral,
  tuple,
  undefined_,
  union,
  unionAsync,
  unknown,
} from "../src/index.ts"
import { assertStandardSchemaConformance, type ConformanceCase } from "./conformance-harness.ts"

/**
 * Canonical Standard Schema contract case table (issue #23). Every public schema
 * primitive runs through the conformance harness here. A new primitive issue adds
 * its schema to this table; that is what makes the harness enforce the contract for
 * it (sync/async parity, the success/failure-by-issues rule, and the strict
 * `{ message, path? }` issue allowlist on the reject path).
 */
const standardCases: ReadonlyArray<ConformanceCase> = [
  { name: "string", schema: string(), async: false, valid: "x", invalid: 1 },
  { name: "number", schema: number(), async: false, valid: 1, invalid: "x" },
  { name: "boolean", schema: boolean(), async: false, valid: true, invalid: 1 },
  { name: "bigint", schema: bigint(), async: false, valid: 1n, invalid: 1 },
  { name: "date", schema: date(), async: false, valid: new Date(0), invalid: "x" },
  { name: "literal", schema: literal("a"), async: false, valid: "a", invalid: "b" },
  { name: "picklist", schema: picklist(["a", "b"]), async: false, valid: "a", invalid: "c" },
  { name: "null_", schema: null_(), async: false, valid: null, invalid: 1 },
  { name: "undefined_", schema: undefined_(), async: false, valid: undefined, invalid: 1 },
  { name: "any", schema: any(), async: false, valid: { whatever: true } },
  { name: "unknown", schema: unknown(), async: false, valid: Symbol("ok") },
  { name: "never_", schema: never_(), async: false, invalid: 1 },
  { name: "nullable", schema: nullable(string()), async: false, valid: null, invalid: 1 },
  { name: "nullish", schema: nullish(string()), async: false, valid: undefined, invalid: 1 },
  { name: "optional", schema: optional(string()), async: false, valid: undefined, invalid: 1 },
  { name: "array", schema: array(string()), async: false, valid: ["x"], invalid: [1] },
  { name: "record", schema: record(number()), async: false, valid: { a: 1 }, invalid: { a: "x" } },
  {
    name: "recordKeyed",
    schema: record(picklist(["a", "b"]), number()),
    async: false,
    valid: { a: 1 },
    invalid: { c: 1 },
  },
  { name: "tuple", schema: tuple([string()]), async: false, valid: ["x"], invalid: [1] },
  {
    name: "object",
    schema: object({ a: string() }),
    async: false,
    valid: { a: "x" },
    invalid: { a: 1 },
  },
  {
    name: "exactObject",
    schema: exactObject({ a: string() }),
    async: false,
    valid: { a: "x" },
    invalid: { a: "x", extra: 1 },
  },
  { name: "union", schema: union([string(), number()]), async: false, valid: "x", invalid: true },
  {
    name: "templateLiteral",
    schema: templateLiteral(["id-", number()]),
    async: false,
    valid: "id-42",
    invalid: "id-x",
  },
  {
    name: "discriminatedUnion",
    schema: discriminatedUnion("kind", [
      object({ kind: literal("a"), x: number() }),
      object({ kind: literal("b"), y: number() }),
    ]),
    async: false,
    valid: { kind: "a", x: 1 },
    invalid: { kind: "c" },
  },
  { name: "lazy", schema: lazy(() => string()), async: false, valid: "x", invalid: 1 },
  {
    name: "recursive",
    schema: recursive((self) => object({ next: optional(self) })),
    async: false,
    valid: { next: { next: undefined } },
    invalid: 1,
  },
  { name: "arrayAsync", schema: arrayAsync(string()), async: true, valid: ["x"], invalid: [1] },
  {
    name: "recordAsync",
    schema: recordAsync(number()),
    async: true,
    valid: { a: 1 },
    invalid: { a: "x" },
  },
  {
    name: "recordAsyncKeyed",
    schema: recordAsync(picklist(["a", "b"]), number()),
    async: true,
    valid: { a: 1 },
    invalid: { c: 1 },
  },
  {
    name: "objectAsync",
    schema: objectAsync({ a: string() }),
    async: true,
    valid: { a: "x" },
    invalid: { a: 1 },
  },
  {
    name: "exactObjectAsync",
    schema: exactObjectAsync({ a: string() }),
    async: true,
    valid: { a: "x" },
    invalid: { a: "x", extra: 1 },
  },
  {
    name: "unionAsync",
    schema: unionAsync([string(), number()]),
    async: true,
    valid: "x",
    invalid: true,
  },
  {
    name: "discriminatedUnionAsync",
    schema: discriminatedUnionAsync("kind", [
      object({ kind: literal("a"), x: number() }),
      objectAsync({ kind: literal("b"), y: number() }),
    ]),
    async: true,
    valid: { kind: "a", x: 1 },
    invalid: { kind: "c" },
  },
]

describe("Standard Schema contract (#23)", () => {
  for (const c of standardCases) {
    it(`${c.name} conforms to the Standard Schema contract`, async () => {
      await assertStandardSchemaConformance(c)
    })
  }
})

/** Builds a fake schema whose validate returns exactly the given issues. */
function fakeFailing(issues: ReadonlyArray<Record<string, unknown>>): never {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "tskm",
      validate: (_value: unknown) => ({ issues }),
    },
  } as never
}

async function captureError(run: () => Promise<void>): Promise<Error | null> {
  try {
    await run()
    return null
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

describe("contract harness rejects leaked internal fields (allowlist is load-bearing)", () => {
  it("flags an issue carrying a non-allowlisted key", async () => {
    // Leaks the internal `kind`/`type` fields onto the issue itself.
    const schema = fakeFailing([
      { message: "bad", path: [{ key: "a" }], kind: "schema", type: "string" },
    ])
    const error = await captureError(() =>
      assertStandardSchemaConformance({ name: "leaky-issue", schema, async: false, invalid: 1 }),
    )
    expect(error?.message).toContain('leaked the internal field "kind"')
  })

  it("flags a path segment carrying a non-key field", async () => {
    // A `{ key }` segment must carry ONLY `key`; an extra field is a leak at the nested layer.
    const schema = fakeFailing([{ message: "bad", path: [{ key: "a", extra: 1 }] }])
    const error = await captureError(() =>
      assertStandardSchemaConformance({ name: "leaky-segment", schema, async: false, invalid: 1 }),
    )
    expect(error?.message).toContain("path segment leaked a non-key field")
  })
})
