import type { DiscoveredSchema } from "../src/discovery.ts"
import { chooseRendering, resolveRegisteredQuery, resolveSchemas } from "../src/resolve.ts"
import type { ResolvedType, TsgoClient } from "../src/tsgo-client.ts"
import { describe, expect, it } from "./test-api.ts"

const OBJECT_FLAGS = 1048576
const STRING_FLAGS = 32
const UNION_FLAGS = 134217728
const INTERSECTION_FLAGS = 268435456
const ANY_FLAGS = 1

const t = (text: string, flags = OBJECT_FLAGS): ResolvedType => ({ flags, text })

// Mirrors the spike-verified matrix: __P (pretty) is byte-identical to raw for
// plain objects/primitives/unions, flattens object-headed intersections, and
// destructively expands ONLY top-level named classes (Date/Map/Set) and branded
// primitives — exactly the cases whose raw text does not start with `{`.
describe("chooseRendering — raw/pretty selection", () => {
  it.each([
    // [label, raw, pretty, expected]
    [
      "plain object → pretty (byte-identical to raw)",
      t("{ name: string; age: number | undefined; }"),
      t("{ name: string; age: number | undefined; }"),
      "{ name: string; age: number | undefined; }",
    ],
    [
      "object-headed intersection → pretty (flattened by __P)",
      t("{ a: string; } & { b: number; }", INTERSECTION_FLAGS),
      t("{ a: string; b: number; }"),
      "{ a: string; b: number; }",
    ],
    [
      "top-level Date → raw (pretty explodes the prototype)",
      t("Date"),
      t("{ toString: () => string; toDateString: () => string; /* …2570 chars… */ }"),
      "Date",
    ],
    [
      "top-level Map → raw",
      t("Map<string, number>"),
      t("{ clear: () => void; delete: (key: string) => boolean; /* … */ }"),
      "Map<string, number>",
    ],
    [
      "top-level Set → raw",
      t("Set<string>"),
      t("{ add: (value: string) => Set<string>; /* … */ }"),
      "Set<string>",
    ],
    [
      "branded primitive → raw (pretty expands the String prototype)",
      t('string & $brand<"UserId">', INTERSECTION_FLAGS),
      t("{ toString: () => string; /* … */ [$brand]: { UserId: true; }; }"),
      'string & $brand<"UserId">',
    ],
    [
      "primitive → raw (identical either way)",
      t("string", STRING_FLAGS),
      t("string", STRING_FLAGS),
      "string",
    ],
    [
      "union → raw (identical either way)",
      t("string | number", UNION_FLAGS),
      t("string | number", UNION_FLAGS),
      "string | number",
    ],
    ["string literal → raw", t('"a"', 1024), t('"a"', 1024), '"a"'],
  ])("%s", (_label, raw, pretty, expected) => {
    expect(chooseRendering(raw, pretty)).toBe(expected)
  })

  it("falls back to raw when the pretty marker failed to resolve", () => {
    expect(chooseRendering(t("{ a: string; }"), t("any", ANY_FLAGS))).toBe("{ a: string; }")
  })

  it("falls back to raw when there is no pretty result at all", () => {
    expect(chooseRendering(t("{ a: string; }"), null)).toBe("{ a: string; }")
  })

  it("tolerates leading whitespace when detecting the object form", () => {
    expect(chooseRendering(t("  { a: string; }"), t("{ a: string; }"))).toBe("{ a: string; }")
  })
})

// A candidate external schema needs a vendor, a guard probe, and raw/pretty markers. Only
// `withSnapshot` is exercised by the resolution loop, so a one-method stub TsgoClient plus a
// scripted `resolveAt` drives the guard/raw outcomes without a real checker.
const candidate = (over: Partial<DiscoveredSchema> = {}): DiscoveredSchema => ({
  name: "userSchema",
  typeName: "User",
  origin: "const",
  recursive: false,
  capability: {
    sourceKind: "standard",
    vendorHint: "zod",
    confidence: "candidate",
    typeResolver: "standard-checker",
    tier1Supported: false,
    inplaceSupported: false,
  },
  ...over,
})

/** Stub whose `resolveAt` returns the scripted verdicts in call order. */
const stubClient = (verdicts: ReadonlyArray<ResolvedType | null>): TsgoClient => {
  let call = 0
  return {
    withSnapshot: <T>(fn: (resolveAt: () => ResolvedType | null) => T): T =>
      fn(() => verdicts[call++] ?? null),
  } as unknown as TsgoClient
}

const FAILURE_FLAGS = 1 | 2 | 262144

describe("resolveSchemas / resolveRegisteredQuery — guard and hint paths", () => {
  it("returns an empty result and never touches the client when there are no schemas", () => {
    // queryArtifact is null for an empty schema list, so resolveSchemas short-circuits before
    // it would ever write or register a query file.
    const untouched = {} as unknown as TsgoClient
    expect(resolveSchemas(untouched, "/project/src/a.ts", [])).toEqual({
      resolved: [],
      diagnostics: [],
    })
  })

  it("adds a version-skew hint when every candidate of a vendor fails the guard", () => {
    // Guard probe resolves to something other than the literal `true`, so the candidate is not
    // a Standard Schema: it is dropped, and because the vendor had zero confirmations a single
    // guidance diagnostic is emitted for that vendor.
    const client = stubClient([{ flags: 0, text: "false" }])
    const result = resolveRegisteredQuery(client, "/project/src/a.ts", [candidate()])
    expect(result.resolved).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toContain(
      'no Standard Schema values found among the "zod" exports',
    )
  })

  it("suggests a self annotation when a confirmed standard schema fails to resolve", () => {
    // Guard passes (`true`) but the raw inference collapses to a failure type: for a standard
    // schema with no captured self-annotation, the skip diagnostic points at the recursive case.
    const client = stubClient([
      { flags: 0, text: "true" },
      { flags: FAILURE_FLAGS, text: "any" },
    ])
    const result = resolveRegisteredQuery(client, "/project/src/a.ts", [candidate()])
    expect(result.resolved).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toContain("add an explicit self type annotation")
  })

  it("drops an unrecognized-vendor candidate silently, with no version-skew hint", () => {
    // A candidate whose import module did not map to a known vendor (vendorHint undefined) does
    // not contribute to the per-vendor tally, so a guard failure leaves no diagnostic at all.
    const client = stubClient([{ flags: 0, text: "false" }])
    const schema = candidate({
      capability: { ...candidate().capability, vendorHint: undefined },
    })
    const result = resolveRegisteredQuery(client, "/project/src/a.ts", [schema])
    expect(result.resolved).toEqual([])
    expect(result.diagnostics).toEqual([])
  })
})
