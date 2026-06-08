// biome-ignore-all lint/suspicious/noTemplateCurlyInString: assertions compare against template-literal type text that contains literal "${...}"
import { describe, expect, it } from "bun:test"
import {
  bigint,
  lazy,
  null_,
  number,
  picklist,
  safeParse,
  string,
  templateLiteral,
} from "../src/index.ts"

/**
 * Runtime validation for the `templateLiteral` schema (issue #18). The input is matched
 * against the concatenation pattern: fixed segments verbatim, placeholders per their kind.
 */
describe("templateLiteral runtime (#18)", () => {
  it("matches a fixed prefix plus a string placeholder", () => {
    const t = templateLiteral(["user_", string()])
    expect(safeParse(t, "user_ada").success).toBe(true)
    expect(safeParse(t, "user_").success).toBe(true)
    expect(safeParse(t, "admin_ada").success).toBe(false)
  })

  it("constrains an enum-and-number shape", () => {
    const t = templateLiteral([picklist(["a", "b"]), "-", number()])
    expect(safeParse(t, "a-12").success).toBe(true)
    expect(safeParse(t, "b-3.5").success).toBe(true)
    expect(safeParse(t, "c-12").success).toBe(false)
    expect(safeParse(t, "a-x").success).toBe(false)
  })

  it("rejects a non-string input", () => {
    const t = templateLiteral(["v", number()])
    expect(safeParse(t, 12).success).toBe(false)
  })

  it("escapes regex metacharacters in fixed segments", () => {
    const t = templateLiteral(["a.b+", string()])
    expect(safeParse(t, "a.b+c").success).toBe(true)
    // The `.` and `+` are literal, not regex operators.
    expect(safeParse(t, "axbxc").success).toBe(false)
  })

  it("reports a descriptive expected on mismatch", () => {
    const t = templateLiteral(["id-", number()])
    const r = safeParse(t, "id-x")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toContain("`id-${number}`")
    }
  })
})

describe("templateLiteral type/runtime soundness (#18 review)", () => {
  it("an empty picklist placeholder matches nothing (output type is never)", () => {
    expect(safeParse(templateLiteral([picklist([])]), "").success).toBe(false)
  })

  it("bigint placeholder rejects a leading + and leading zeros", () => {
    const t = templateLiteral([bigint()])
    expect(safeParse(t, "0").success).toBe(true)
    expect(safeParse(t, "-12").success).toBe(true)
    expect(safeParse(t, "+1").success).toBe(false)
    expect(safeParse(t, "01").success).toBe(false)
  })

  it("null placeholder matches only its literal text", () => {
    expect(safeParse(templateLiteral([null_()]), "null").success).toBe(true)
    expect(safeParse(templateLiteral([null_()]), "x").success).toBe(false)
  })

  it("an unsupported placeholder kind is a construction error", () => {
    // `lazy` output is string (a valid placeholder type), but its kind cannot be bounded
    // by a regex fragment, so it fails closed at construction rather than any-matching.
    expect(() => templateLiteral([lazy(() => string())])).toThrow()
  })
})
