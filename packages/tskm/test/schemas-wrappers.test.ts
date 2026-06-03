import { describe, expect, it } from "bun:test"
import type { BaseSchema, GenericSchema } from "../src/index.ts"
import {
  lazy,
  nullable,
  nullish,
  number,
  object,
  optional,
  parse,
  recursive,
  safeParse,
  string,
} from "../src/index.ts"

describe("optional", () => {
  it("accepts a valid wrapped value", () => {
    expect(parse(optional(string()), "hi")).toBe("hi")
  })

  it("accepts undefined and yields undefined without a default", () => {
    expect(parse(optional(string()), undefined)).toBe(undefined)
  })

  it("rejects null (only undefined is the absent value)", () => {
    const r = safeParse(optional(string()), null)
    expect(r.success).toBe(false)
  })

  it("rejects an invalid wrapped value", () => {
    const r = safeParse(optional(string()), 123)
    expect(r.success).toBe(false)
  })

  it("applies a literal default when input is undefined", () => {
    expect(parse(optional(string(), "fallback"), undefined)).toBe("fallback")
  })

  it("does not apply the default when a value is present", () => {
    expect(parse(optional(string(), "fallback"), "given")).toBe("given")
  })

  it("applies a function default when input is undefined", () => {
    expect(
      parse(
        optional(string(), () => "lazy"),
        undefined,
      ),
    ).toBe("lazy")
  })

  it("exposes its shape on the schema object", () => {
    const schema = optional(string(), "d")
    expect(schema.type).toBe("optional")
    expect(schema.expects).toBe("(string | undefined)")
    expect(schema.default).toBe("d")
    expect(schema.wrapped.type).toBe("string")
    expect(schema.async).toBe(false)
  })

  it("leaves default undefined when none is provided", () => {
    expect(optional(string()).default).toBe(undefined)
  })
})

describe("nullable", () => {
  it("accepts a valid wrapped value", () => {
    expect(parse(nullable(string()), "hi")).toBe("hi")
  })

  it("accepts null and keeps null without a default", () => {
    expect(parse(nullable(string()), null)).toBe(null)
  })

  it("rejects undefined (only null is the absent value)", () => {
    const r = safeParse(nullable(string()), undefined)
    expect(r.success).toBe(false)
  })

  it("rejects an invalid wrapped value", () => {
    const r = safeParse(nullable(string()), 123)
    expect(r.success).toBe(false)
  })

  it("applies a literal default when input is null", () => {
    expect(parse(nullable(string(), "fallback"), null)).toBe("fallback")
  })

  it("does not apply the default when a value is present", () => {
    expect(parse(nullable(string(), "fallback"), "given")).toBe("given")
  })

  it("applies a function default when input is null", () => {
    expect(
      parse(
        nullable(string(), () => "lazy"),
        null,
      ),
    ).toBe("lazy")
  })

  it("exposes its shape on the schema object", () => {
    const schema = nullable(string(), "d")
    expect(schema.type).toBe("nullable")
    expect(schema.expects).toBe("(string | null)")
    expect(schema.default).toBe("d")
    expect(schema.wrapped.type).toBe("string")
  })

  it("leaves default undefined when none is provided", () => {
    expect(nullable(string()).default).toBe(undefined)
  })
})

describe("nullish", () => {
  it("accepts a valid wrapped value", () => {
    expect(parse(nullish(string()), "hi")).toBe("hi")
  })

  it("accepts null and keeps null without a default", () => {
    expect(parse(nullish(string()), null)).toBe(null)
  })

  it("accepts undefined and keeps undefined without a default", () => {
    expect(parse(nullish(string()), undefined)).toBe(undefined)
  })

  it("rejects an invalid wrapped value", () => {
    const r = safeParse(nullish(string()), 123)
    expect(r.success).toBe(false)
  })

  it("applies a literal default when input is null", () => {
    expect(parse(nullish(string(), "fallback"), null)).toBe("fallback")
  })

  it("applies a literal default when input is undefined", () => {
    expect(parse(nullish(string(), "fallback"), undefined)).toBe("fallback")
  })

  it("does not apply the default when a value is present", () => {
    expect(parse(nullish(string(), "fallback"), "given")).toBe("given")
  })

  it("applies a function default when input is null or undefined", () => {
    expect(
      parse(
        nullish(string(), () => "lazy"),
        null,
      ),
    ).toBe("lazy")
    expect(
      parse(
        nullish(string(), () => "lazy"),
        undefined,
      ),
    ).toBe("lazy")
  })

  it("exposes its shape on the schema object", () => {
    const schema = nullish(string(), "d")
    expect(schema.type).toBe("nullish")
    expect(schema.expects).toBe("(string | null | undefined)")
    expect(schema.default).toBe("d")
    expect(schema.wrapped.type).toBe("string")
  })

  it("leaves default undefined when none is provided", () => {
    expect(nullish(string()).default).toBe(undefined)
  })
})

describe("lazy", () => {
  // Recursive list node: { value, next?: node } — `next` defers to the same schema.
  type NodeSchema = BaseSchema<unknown, unknown>
  const node: NodeSchema = object({
    value: number(),
    next: optional(lazy<NodeSchema>(() => node)),
  })

  it("parses a non-nested value", () => {
    expect(parse(node, { value: 1, next: undefined })).toEqual({ value: 1, next: undefined })
  })

  it("parses a deeply nested recursive value", () => {
    const input = { value: 1, next: { value: 2, next: { value: 3, next: undefined } } }
    expect(parse(node, input)).toEqual(input)
  })

  it("fails when a nested node is invalid", () => {
    const r = safeParse(node, { value: 1, next: { value: "bad", next: undefined } })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.path).toEqual([{ key: "next" }, { key: "value" }])
    }
  })

  it("memoizes the resolved schema (getter runs once across calls)", () => {
    let calls = 0
    const schema = lazy(() => {
      calls++
      return string()
    })
    expect(parse(schema, "a")).toBe("a")
    expect(parse(schema, "b")).toBe("b")
    expect(calls).toBe(1)
  })

  it("exposes its shape on the schema object", () => {
    const getter = () => string()
    const schema = lazy(getter)
    expect(schema.type).toBe("lazy")
    expect(schema.expects).toBe("unknown")
    expect(schema.getter).toBe(getter)
    expect(schema.async).toBe(false)
  })

  it("defers directly to the resolved schema's result", () => {
    expect(
      parse(
        lazy(() => number()),
        42,
      ),
    ).toBe(42)
    expect(
      safeParse(
        lazy(() => number()),
        "x",
      ).success,
    ).toBe(false)
  })
})

describe("recursive", () => {
  // Recursive tree node WITHOUT any type annotation: `self` is passed into the
  // builder, so the initializer never references its own const (no implicit any).
  const node = recursive((self) =>
    object({
      value: number(),
      next: optional(self),
    }),
  )

  it("parses a non-nested value", () => {
    expect(parse(node, { value: 1, next: undefined })).toEqual({ value: 1, next: undefined })
  })

  it("parses a deeply nested recursive value", () => {
    const input = { value: 1, next: { value: 2, next: { value: 3, next: undefined } } }
    expect(parse(node, input)).toEqual(input)
  })

  it("fails with the correct nested path", () => {
    const r = safeParse(node, { value: 1, next: { value: "bad", next: undefined } })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.path).toEqual([{ key: "next" }, { key: "value" }])
    }
  })

  it("passes the returned schema object itself as `self` (identity anchor)", () => {
    let captured: unknown
    const schema = recursive((self) => {
      captured = self
      return object({ next: optional(self) })
    })
    parse(schema, { next: undefined }) // force the lazy build
    expect(captured).toBe(schema)
  })

  it("memoizes the built body (build runs once across parses)", () => {
    let calls = 0
    const schema = recursive((self) => {
      calls++
      return object({ next: optional(self) })
    })
    parse(schema, { next: undefined })
    parse(schema, { next: { next: undefined } })
    expect(calls).toBe(1)
  })

  it("getter() returns the same body object by identity on repeat calls", () => {
    const schema = recursive((self) => object({ next: optional(self) }))
    expect(schema.getter()).toBe(schema.getter())
  })

  it("does not invoke build in the initializer (lazy until first use)", () => {
    let calls = 0
    const schema = recursive((self) => {
      calls++
      return object({ next: optional(self) })
    })
    expect(calls).toBe(0)
    parse(schema, { next: undefined })
    expect(calls).toBe(1)
  })

  it("exposes its shape on the schema object", () => {
    const build = (self: GenericSchema) => object({ next: optional(self) })
    const schema = recursive(build)
    expect(schema.type).toBe("recursive")
    expect(schema.expects).toBe("unknown")
    expect(schema.build).toBe(build)
    expect(schema.async).toBe(false)
  })

  it("supports a generic-arrow build (the Tier-1 capable authoring shape)", () => {
    const schema = recursive(<S extends GenericSchema>(self: S) =>
      object({
        name: string(),
        children: optional(self),
      }),
    )
    const input = { name: "a", children: { name: "b", children: undefined } }
    expect(parse(schema, input)).toEqual(input)
  })
})
