import { describe, expect, it } from "bun:test"
import { integer, maxValue, minValue, multipleOf, number, pipe, safeParse } from "../src/index.ts"
import { defaultConfig } from "../src/types/config.ts"

describe("integer", () => {
  const schema = pipe(number(), integer())

  it("passes for whole numbers including negatives and zero", () => {
    expect(safeParse(schema, 2).success).toBe(true)
    expect(safeParse(schema, 0).success).toBe(true)
    expect(safeParse(schema, -7).success).toBe(true)
  })

  it("fails for a fractional number", () => {
    const r = safeParse(schema, 1.5)
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.kind).toBe("validation")
      expect(issue?.type).toBe("integer")
      // integer passes expected:null, so message uses the "Received" form
      expect(issue?.expected).toBe(null)
      expect(issue?.received).toBe("1.5")
      expect(issue?.message).toBe("Invalid integer: Received 1.5")
    }
  })

  it("does not run its check when the base schema already produced an untyped dataset", () => {
    // a non-number input is untyped after number(); integer must not add a second issue
    const r = safeParse(schema, "nope")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("number")
    }
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(pipe(number(), integer("must be int")), 2.5)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("must be int")
    }
  })

  it("exposes the action metadata", () => {
    const action = integer()
    expect(action.kind).toBe("validation")
    expect(action.type).toBe("integer")
    expect(action.reference).toBe(integer)
    expect(action.expects).toBe(null)
    expect(action.async).toBe(false)
    expect(action.requirement).toBe(Number.isInteger)
    expect(action.message).toBeUndefined()
  })
})

describe("minValue", () => {
  const schema = pipe(number(), minValue(10))

  it("passes when above the bound", () => {
    expect(safeParse(schema, 11).success).toBe(true)
  })

  it("passes exactly at the bound", () => {
    expect(safeParse(schema, 10).success).toBe(true)
  })

  it("fails just below the bound", () => {
    const r = safeParse(schema, 9)
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.kind).toBe("validation")
      expect(issue?.type).toBe("min_value")
      expect(issue?.expected).toBe(">=10")
      expect(issue?.received).toBe("9")
      expect(issue?.message).toBe("Invalid min_value: Expected >=10 but received 9")
    }
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(pipe(number(), minValue(10, "too small")), 9)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("too small")
    }
  })

  it("exposes the action metadata", () => {
    const action = minValue(10)
    expect(action.kind).toBe("validation")
    expect(action.type).toBe("min_value")
    expect(action.reference).toBe(minValue)
    expect(action.expects).toBe(">=10")
    expect(action.async).toBe(false)
    expect(action.requirement).toBe(10)
    expect(action.message).toBeUndefined()
  })

  it("renders a Date requirement via toJSON in expects", () => {
    const d = new Date("2020-01-01T00:00:00.000Z")
    const action = minValue<Date, Date>(d)
    expect(action.expects).toBe(`>=${d.toJSON()}`)
    // running the action against a typed dataset below the bound adds a Date-rendered issue
    const ds = action["~run"](
      { typed: true, value: new Date("2019-01-01T00:00:00.000Z") },
      defaultConfig,
    )
    expect(ds.issues?.[0]?.expected).toBe(`>=${d.toJSON()}`)
    expect(ds.issues?.[0]?.received).toBe("Date")
  })

  it("does not run its check when the base schema already produced an untyped dataset", () => {
    // a non-number input is untyped after number(); minValue must not add a second issue
    const r = safeParse(pipe(number(), minValue(10)), "nope")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("number")
    }
  })
})

describe("maxValue", () => {
  const schema = pipe(number(), maxValue(10))

  it("passes when below the bound", () => {
    expect(safeParse(schema, 9).success).toBe(true)
  })

  it("passes exactly at the bound", () => {
    expect(safeParse(schema, 10).success).toBe(true)
  })

  it("fails just above the bound", () => {
    const r = safeParse(schema, 11)
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.kind).toBe("validation")
      expect(issue?.type).toBe("max_value")
      expect(issue?.expected).toBe("<=10")
      expect(issue?.received).toBe("11")
      expect(issue?.message).toBe("Invalid max_value: Expected <=10 but received 11")
    }
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(pipe(number(), maxValue(10, "too big")), 11)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("too big")
    }
  })

  it("exposes the action metadata", () => {
    const action = maxValue(10)
    expect(action.kind).toBe("validation")
    expect(action.type).toBe("max_value")
    expect(action.reference).toBe(maxValue)
    expect(action.expects).toBe("<=10")
    expect(action.async).toBe(false)
    expect(action.requirement).toBe(10)
    expect(action.message).toBeUndefined()
  })

  it("renders a Date requirement via toJSON in expects", () => {
    const d = new Date("2020-01-01T00:00:00.000Z")
    const action = maxValue<Date, Date>(d)
    expect(action.expects).toBe(`<=${d.toJSON()}`)
    const ds = action["~run"](
      { typed: true, value: new Date("2021-01-01T00:00:00.000Z") },
      defaultConfig,
    )
    expect(ds.issues?.[0]?.expected).toBe(`<=${d.toJSON()}`)
    expect(ds.issues?.[0]?.received).toBe("Date")
  })

  it("does not run its check when the base schema already produced an untyped dataset", () => {
    const r = safeParse(pipe(number(), maxValue(10)), "nope")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("number")
    }
  })
})

describe("multipleOf", () => {
  const schema = pipe(number(), multipleOf(3))

  it("passes when evenly divisible (6 % 3 === 0)", () => {
    expect(safeParse(schema, 6).success).toBe(true)
    expect(safeParse(schema, 0).success).toBe(true)
    expect(safeParse(schema, -9).success).toBe(true)
  })

  it("fails when not evenly divisible (7 % 3 !== 0)", () => {
    const r = safeParse(schema, 7)
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.issues[0]
      expect(issue?.kind).toBe("validation")
      expect(issue?.type).toBe("multiple_of")
      expect(issue?.expected).toBe("%3")
      expect(issue?.received).toBe("7")
      expect(issue?.message).toBe("Invalid multiple_of: Expected %3 but received 7")
    }
  })

  it("uses a custom message when provided", () => {
    const r = safeParse(pipe(number(), multipleOf(3, "not a multiple")), 7)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toBe("not a multiple")
    }
  })

  it("exposes the action metadata", () => {
    const action = multipleOf(3)
    expect(action.kind).toBe("validation")
    expect(action.type).toBe("multiple_of")
    expect(action.reference).toBe(multipleOf)
    expect(action.expects).toBe("%3")
    expect(action.async).toBe(false)
    expect(action.requirement).toBe(3)
    expect(action.message).toBeUndefined()
  })

  it("does not run its check when the base schema already produced an untyped dataset", () => {
    const r = safeParse(pipe(number(), multipleOf(3)), "nope")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]?.type).toBe("number")
    }
  })
})
