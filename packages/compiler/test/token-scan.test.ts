import { describe, expect, it } from "bun:test"
import { containsTokenOutsideQuotes, replaceTokenOutsideQuotes } from "../src/token-scan.ts"

// These are the quote-aware, whole-word scanners that the Tier-1 sentinel substitution
// and the dangling-alias prune both rely on. Every span inside a string literal MUST be
// treated as opaque (it is rendered TS *type text*, where a literal like "Foo" is a value,
// not an identifier) and every match MUST be a whole word, or the substitution corrupts
// the emitted source. The cases below pin those two invariants directly.

describe("replaceTokenOutsideQuotes", () => {
  it("leaves a token untouched inside a double-quoted literal with escaped quotes", () => {
    // The literal carries escaped inner quotes (`"x\"Foo\""`); the scanner must keep
    // honoring `\` escapes so it does not mistake an escaped `"` for the literal's end
    // and resume word-matching inside the string, where `Foo` is text, not an alias.
    const text = '"x\\"Foo\\""'
    const { result, replaced } = replaceTokenOutsideQuotes(text, "Foo", "Bar")
    expect(result).toBe(text)
    expect(replaced).toBe(0)
  })

  it("leaves a token untouched inside a backtick (template) literal", () => {
    // Backtick spans are opaque too — `Foo` inside `` `Foo` `` is template text.
    const text = "`Foo`"
    const { result, replaced } = replaceTokenOutsideQuotes(text, "Foo", "Bar")
    expect(result).toBe(text)
    expect(replaced).toBe(0)
  })

  it("leaves a token untouched inside a single-quoted literal", () => {
    const text = "'Foo'"
    const { result, replaced } = replaceTokenOutsideQuotes(text, "Foo", "Bar")
    expect(result).toBe(text)
    expect(replaced).toBe(0)
  })

  it("does not replace a token adjacent to word characters (whole-word only)", () => {
    // `Foo` is a substring of the identifiers `FooBar`, `xFoo`, and `Foo1`; replacing
    // any of them would rename an unrelated alias, so the word-boundary guard must reject
    // a match flanked by [A-Za-z0-9_$].
    for (const text of ["FooBar", "xFoo", "Foo1", "Foo_"]) {
      const { result, replaced } = replaceTokenOutsideQuotes(text, "Foo", "Bar")
      expect(result).toBe(text)
      expect(replaced).toBe(0)
    }
  })

  it("replaces a token at the very start of the string (no preceding char)", () => {
    // prev char is undefined at index 0 — isWord(undefined) is false, so the boundary
    // check passes and the leading token is replaced.
    const { result, replaced } = replaceTokenOutsideQuotes("Foo | number", "Foo", "Bar")
    expect(result).toBe("Bar | number")
    expect(replaced).toBe(1)
  })

  it("replaces a token at the very end of the string (no following char)", () => {
    // next char is undefined past the end — the trailing token is still a whole word.
    const { result, replaced } = replaceTokenOutsideQuotes("number | Foo", "Foo", "Bar")
    expect(result).toBe("number | Foo".replace("Foo", "Bar"))
    expect(replaced).toBe(1)
  })

  it("replaces only the whole-word occurrences and counts them correctly", () => {
    // Mixed input: two standalone `Foo` (replaced) plus one inside `FooBar` and one inside
    // a literal "Foo" (both skipped) — replaced count must be exactly 2.
    const text = 'Foo | FooBar | "Foo" | Foo[]'
    const { result, replaced } = replaceTokenOutsideQuotes(text, "Foo", "Bar")
    expect(result).toBe('Bar | FooBar | "Foo" | Bar[]')
    expect(replaced).toBe(2)
  })

  it("replaces a token that sits between quoted spans without touching the literals", () => {
    const text = '"keepFoo" + Foo + `alsoFoo`'
    const { result, replaced } = replaceTokenOutsideQuotes(text, "Foo", "Bar")
    expect(result).toBe('"keepFoo" + Bar + `alsoFoo`')
    expect(replaced).toBe(1)
  })

  it("does not hang or throw on an unterminated string literal", () => {
    // A malformed (unclosed) literal must drain to end-of-input rather than loop forever;
    // the trailing token lives inside that opaque span, so nothing is replaced.
    const text = '"unterminated Foo'
    const { result, replaced } = replaceTokenOutsideQuotes(text, "Foo", "Bar")
    expect(result).toBe(text)
    expect(replaced).toBe(0)
  })

  it("returns the input unchanged with zero replacements when the token is absent", () => {
    const { result, replaced } = replaceTokenOutsideQuotes("string | number", "Foo", "Bar")
    expect(result).toBe("string | number")
    expect(replaced).toBe(0)
  })
})

describe("containsTokenOutsideQuotes", () => {
  it("is true for a whole-word token outside any literal", () => {
    expect(containsTokenOutsideQuotes("Foo | number", "Foo")).toBe(true)
  })

  it("is false when the only occurrence is inside a literal", () => {
    // The detector is the substitution's replaced>0 in disguise; a quoted-only token
    // must read as absent so the prune does not treat a string literal as a live alias.
    expect(containsTokenOutsideQuotes('"Foo"', "Foo")).toBe(false)
  })

  it("is false when the only occurrence is a substring of a larger identifier", () => {
    expect(containsTokenOutsideQuotes("FooBar", "Foo")).toBe(false)
  })

  it("is false when the token does not occur at all", () => {
    expect(containsTokenOutsideQuotes("string | number", "Foo")).toBe(false)
  })
})
