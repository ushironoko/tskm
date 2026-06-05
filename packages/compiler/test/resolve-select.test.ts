import { describe, expect, it } from "bun:test"
import { chooseRendering } from "../src/resolve.ts"
import type { ResolvedType } from "../src/tsgo-client.ts"

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
