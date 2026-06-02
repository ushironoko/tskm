import { describe, expect, it } from "bun:test"
import {
  any,
  bigint,
  boolean,
  date,
  literal,
  never_,
  null_,
  number,
  parse,
  picklist,
  safeParse,
  undefined_,
  unknown,
} from "../src/index.ts"

describe("number", () => {
  it("parses a valid number", () => {
    expect(parse(number(), 42)).toBe(42)
  })

  it("rejects a non-number with a schema issue", () => {
    const r = safeParse(number(), "nope")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.kind).toBe("schema")
      expect(r.issues[0]?.type).toBe("number")
      expect(r.issues[0]?.expected).toBe("number")
    }
  })

  it("rejects NaN (the !Number.isNaN guard branch)", () => {
    const r = safeParse(number(), Number.NaN)
    expect(r.success).toBe(false)
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(number("must be a number"), "x")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("must be a number")
    }
  })

  it("exposes Standard Schema props", () => {
    const s = number()
    expect(s["~standard"].version).toBe(1)
    expect(s["~standard"].vendor).toBe("tskm")
    expect(s["~standard"].validate(7)).toEqual({ value: 7 })
  })
})

describe("boolean", () => {
  it("parses true and false", () => {
    expect(parse(boolean(), true)).toBe(true)
    expect(parse(boolean(), false)).toBe(false)
  })

  it("rejects a non-boolean", () => {
    const r = safeParse(boolean(), "true")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("boolean")
      expect(r.issues[0]?.expected).toBe("boolean")
    }
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(boolean("nope"), 0)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("nope")
    }
  })

  it("validate via ~standard reports issues on failure", () => {
    const result = boolean()["~standard"].validate("x")
    expect("issues" in result).toBe(true)
  })
})

describe("bigint", () => {
  it("parses a bigint", () => {
    expect(parse(bigint(), 1n)).toBe(1n)
  })

  it("rejects a plain number", () => {
    const r = safeParse(bigint(), 1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("bigint")
      expect(r.issues[0]?.expected).toBe("bigint")
    }
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(bigint("need bigint"), 1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("need bigint")
    }
  })
})

describe("date", () => {
  it("parses a valid Date instance", () => {
    const d = new Date(0)
    expect(parse(date(), d)).toBe(d)
  })

  it("rejects a string", () => {
    const r = safeParse(date(), "2020-01-01")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("date")
      expect(r.issues[0]?.expected).toBe("Date")
    }
  })

  it("rejects an Invalid Date (the !Number.isNaN(getTime()) guard branch)", () => {
    const r = safeParse(date(), new Date("not-a-date"))
    expect(r.success).toBe(false)
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(date("bad date"), 123)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("bad date")
    }
  })
})

describe("literal", () => {
  it("accepts the exact string literal", () => {
    expect(parse(literal("x"), "x")).toBe("x")
  })

  it("rejects any other value", () => {
    const r = safeParse(literal("x"), "y")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("literal")
      expect(r.issues[0]?.expected).toBe('"x"')
    }
  })

  it("accepts a number literal and formats expected without quotes", () => {
    expect(parse(literal(42), 42)).toBe(42)
    const r = safeParse(literal(42), 43)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.expected).toBe("42")
    }
  })

  it("accepts a boolean literal", () => {
    expect(parse(literal(true), true)).toBe(true)
    expect(safeParse(literal(true), false).success).toBe(false)
  })

  it("exposes the literal value and expects on the schema", () => {
    const s = literal("hi")
    expect(s.literal).toBe("hi")
    expect(s.expects).toBe('"hi"')
    expect(literal(7).expects).toBe("7")
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(literal("x", "expected x"), "z")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("expected x")
    }
  })
})

describe("picklist", () => {
  it("accepts a member", () => {
    expect(parse(picklist(["a", "b"]), "a")).toBe("a")
    expect(parse(picklist(["a", "b"]), "b")).toBe("b")
  })

  it("rejects a non-member", () => {
    const r = safeParse(picklist(["a", "b"]), "c")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("picklist")
      expect(r.issues[0]?.expected).toBe('"a" | "b"')
    }
  })

  it("formats numeric and boolean options in expected", () => {
    const s = picklist([1, 2, true])
    expect(s.expects).toBe("1 | 2 | true")
    expect(s.options).toEqual([1, 2, true])
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(picklist(["a"], "not allowed"), "z")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("not allowed")
    }
  })
})

describe("any", () => {
  it("accepts any input and returns it unchanged", () => {
    expect(parse(any(), 123)).toBe(123)
    expect(parse(any(), "s")).toBe("s")
    expect(parse(any(), null)).toBe(null)
    expect(parse(any(), undefined)).toBe(undefined)
  })

  it("never produces issues via ~standard", () => {
    expect(any()["~standard"].validate(null)).toEqual({ value: null })
  })
})

describe("unknown", () => {
  it("accepts any input and returns it unchanged", () => {
    expect(parse(unknown(), 123)).toBe(123)
    expect(parse(unknown(), null)).toBe(null)
    expect(parse(unknown(), undefined)).toBe(undefined)
  })

  it("never produces issues via ~standard", () => {
    expect(unknown()["~standard"].validate("anything")).toEqual({ value: "anything" })
  })
})

describe("never_", () => {
  it("always fails, even for a normal value", () => {
    const r = safeParse(never_(), 1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("never")
      expect(r.issues[0]?.expected).toBe("never")
    }
  })

  it("fails for undefined too", () => {
    expect(safeParse(never_(), undefined).success).toBe(false)
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(never_("nothing allowed"), 1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("nothing allowed")
    }
  })
})

describe("null_", () => {
  it("accepts null", () => {
    expect(parse(null_(), null)).toBe(null)
  })

  it("rejects undefined and other values", () => {
    expect(safeParse(null_(), undefined).success).toBe(false)
    const r = safeParse(null_(), 0)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("null")
      expect(r.issues[0]?.expected).toBe("null")
    }
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(null_("need null"), 1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("need null")
    }
  })
})

describe("undefined_", () => {
  it("accepts undefined", () => {
    expect(parse(undefined_(), undefined)).toBe(undefined)
  })

  it("rejects null and other values", () => {
    expect(safeParse(undefined_(), null).success).toBe(false)
    const r = safeParse(undefined_(), 0)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.type).toBe("undefined")
      expect(r.issues[0]?.expected).toBe("undefined")
    }
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(undefined_("need undefined"), 1)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("need undefined")
    }
  })
})
