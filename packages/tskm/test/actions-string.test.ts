import { describe, expect, it } from "bun:test"
import {
  array,
  email,
  length,
  maxLength,
  minLength,
  nonEmpty,
  number,
  parse,
  pipe,
  regex,
  safeParse,
  string,
  url,
} from "../src/index.ts"

describe("email", () => {
  it("passes a valid address", () => {
    const r = safeParse(pipe(string(), email()), "user@example.com")
    expect(r.success).toBe(true)
    if (r.success) expect(r.output).toBe("user@example.com")
  })

  it("passes addresses with +, dots and subdomains", () => {
    expect(safeParse(pipe(string(), email()), "a.b+c@sub.example.co").success).toBe(true)
  })

  it("fails a malformed address with exactly one issue", () => {
    const r = safeParse(pipe(string(), email()), "not-an-email")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("email")
      expect(r.issues[0]?.kind).toBe("validation")
      expect(r.issues[0]?.expected).toBe(null)
    }
  })

  it("fails an address missing TLD", () => {
    const r = safeParse(pipe(string(), email()), "user@example")
    expect(r.success).toBe(false)
    if (!r.success) expect(r.issues[0]?.type).toBe("email")
  })

  it("default message is the null-expected form", () => {
    const r = safeParse(pipe(string(), email()), "bad")
    if (!r.success) {
      expect(r.issues[0]?.message).toContain("Invalid email")
      expect(r.issues[0]?.message).toContain("Received")
    }
  })

  it("honors a custom message", () => {
    const r = safeParse(pipe(string(), email("nope")), "bad")
    if (!r.success) expect(r.issues[0]?.message).toBe("nope")
  })

  it("exposes the requirement RegExp on the action object", () => {
    expect(email().requirement).toBeInstanceOf(RegExp)
    expect(email().type).toBe("email")
  })
})

describe("url", () => {
  it("passes a valid URL", () => {
    expect(safeParse(pipe(string(), url()), "https://example.com").success).toBe(true)
  })

  it("passes other schemes the URL ctor accepts", () => {
    expect(safeParse(pipe(string(), url()), "ftp://host/path").success).toBe(true)
  })

  it("fails an invalid URL with exactly one issue", () => {
    const r = safeParse(pipe(string(), url()), "not a url")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("url")
      expect(r.issues[0]?.expected).toBe(null)
    }
  })

  it("honors a custom message", () => {
    const r = safeParse(pipe(string(), url("bad url")), "::::")
    if (!r.success) expect(r.issues[0]?.message).toBe("bad url")
  })

  it("exposes the requirement predicate", () => {
    expect(url().requirement("https://x.dev")).toBe(true)
    expect(url().requirement("nope")).toBe(false)
  })
})

describe("regex", () => {
  const digits = /^\d+$/

  it("passes when the pattern matches", () => {
    expect(safeParse(pipe(string(), regex(digits)), "12345").success).toBe(true)
  })

  it("fails when the pattern does not match, exactly one issue", () => {
    const r = safeParse(pipe(string(), regex(digits)), "12a45")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("regex")
      expect(r.issues[0]?.expected).toBe(`${digits}`)
    }
  })

  it("default message references the stringified pattern", () => {
    const r = safeParse(pipe(string(), regex(digits)), "x")
    if (!r.success) {
      expect(r.issues[0]?.message).toContain(`${digits}`)
    }
  })

  it("honors a custom message", () => {
    const r = safeParse(pipe(string(), regex(digits, "digits only")), "x")
    if (!r.success) expect(r.issues[0]?.message).toBe("digits only")
  })

  it("exposes expects/requirement on the action", () => {
    const a = regex(digits)
    expect(a.requirement).toBe(digits)
    expect(a.expects).toBe(`${digits}`)
    expect(a.type).toBe("regex")
  })
})

describe("length (string)", () => {
  const exactly3 = pipe(string(), length(3))

  it("passes a string of the exact length", () => {
    expect(parse(exactly3, "abc")).toBe("abc")
  })

  it("fails a shorter string", () => {
    const r = safeParse(exactly3, "ab")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("length")
      expect(r.issues[0]?.expected).toBe("3")
    }
  })

  it("fails a longer string", () => {
    const r = safeParse(exactly3, "abcd")
    expect(r.success).toBe(false)
    if (!r.success) expect(r.issues[0]?.type).toBe("length")
  })

  it("honors a custom message", () => {
    const r = safeParse(pipe(string(), length(3, "len!")), "ab")
    if (!r.success) expect(r.issues[0]?.message).toBe("len!")
  })
})

describe("length (array)", () => {
  it("passes an array of the exact length", () => {
    const r = safeParse(pipe(array(number()), length(2)), [1, 2])
    expect(r.success).toBe(true)
  })

  it("fails an array of the wrong length", () => {
    const r = safeParse(pipe(array(number()), length(2)), [1])
    expect(r.success).toBe(false)
    if (!r.success) expect(r.issues[0]?.type).toBe("length")
  })
})

describe("maxLength", () => {
  const max3 = pipe(string(), maxLength(3))

  it("passes a string below the max", () => {
    expect(safeParse(max3, "ab").success).toBe(true)
  })

  it("passes a string exactly at the max boundary", () => {
    expect(safeParse(max3, "abc").success).toBe(true)
  })

  it("fails a string over the max with one issue", () => {
    const r = safeParse(max3, "abcd")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("max_length")
      expect(r.issues[0]?.expected).toBe("<=3")
    }
  })

  it("works on arrays", () => {
    expect(safeParse(pipe(array(number()), maxLength(2)), [1, 2]).success).toBe(true)
    expect(safeParse(pipe(array(number()), maxLength(2)), [1, 2, 3]).success).toBe(false)
  })

  it("honors a custom message", () => {
    const r = safeParse(pipe(string(), maxLength(1, "too long")), "ab")
    if (!r.success) expect(r.issues[0]?.message).toBe("too long")
  })
})

describe("minLength", () => {
  const min3 = pipe(string(), minLength(3))

  it("passes a string above the min", () => {
    expect(safeParse(min3, "abcd").success).toBe(true)
  })

  it("passes a string exactly at the min boundary", () => {
    expect(safeParse(min3, "abc").success).toBe(true)
  })

  it("fails a string under the min with one issue", () => {
    const r = safeParse(min3, "ab")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("min_length")
      expect(r.issues[0]?.expected).toBe(">=3")
    }
  })

  it("works on arrays", () => {
    expect(safeParse(pipe(array(number()), minLength(2)), [1, 2]).success).toBe(true)
    expect(safeParse(pipe(array(number()), minLength(2)), [1]).success).toBe(false)
  })

  it("honors a custom message", () => {
    const r = safeParse(pipe(string(), minLength(3, "too short")), "ab")
    if (!r.success) expect(r.issues[0]?.message).toBe("too short")
  })
})

describe("nonEmpty", () => {
  const ne = pipe(string(), nonEmpty())

  it("passes a non-empty string", () => {
    expect(parse(ne, "x")).toBe("x")
  })

  it("fails an empty string with exactly one issue", () => {
    const r = safeParse(ne, "")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("non_empty")
      expect(r.issues[0]?.expected).toBe("!0")
    }
  })

  it("passes a non-empty array and fails an empty one", () => {
    expect(safeParse(pipe(array(number()), nonEmpty()), [1]).success).toBe(true)
    const r = safeParse(pipe(array(number()), nonEmpty()), [])
    expect(r.success).toBe(false)
    if (!r.success) expect(r.issues[0]?.type).toBe("non_empty")
  })

  it("honors a custom message", () => {
    const r = safeParse(pipe(string(), nonEmpty("required")), "")
    if (!r.success) expect(r.issues[0]?.message).toBe("required")
  })

  it("the action has no requirement field but a fixed expects", () => {
    expect(nonEmpty().expects).toBe("!0")
    expect(nonEmpty().type).toBe("non_empty")
  })
})

describe("action does not run when the upstream schema is untyped", () => {
  it("only the string schema issue is reported, not the email issue", () => {
    const r = safeParse(pipe(string(), email()), 123)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("string")
    }
  })
})
