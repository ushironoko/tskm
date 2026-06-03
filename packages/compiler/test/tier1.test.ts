import { describe, expect, it } from "bun:test"
import { buildSentinelQuery, substituteSentinel } from "../src/tier1.ts"

describe("buildSentinelQuery — the verified unroll query form", () => {
  it("emits one unique-symbol sentinel + one marker per target", () => {
    const { body, markers } = buildSentinelQuery("./category.schema", [
      { exportName: "categorySchema", typeName: "Category" },
      { exportName: "nodeSchema", typeName: "Node" },
    ])
    expect(markers).toEqual(["__tskm_0", "__tskm_1"])
    expect(body).toContain('import { categorySchema, nodeSchema } from "./category.schema"')
    expect(body).toContain('import type { BaseSchema, InferOutput } from "@tskm/core"')
    expect(body).toContain("type __P<T> = { [K in keyof T]: T[K] } & {}")
    expect(body).toContain("declare const SENTINEL_0: unique symbol")
    expect(body).toContain('type Sentinel_0 = { readonly [SENTINEL_0]: "__TskmSentinel_0__" }')
    expect(body).toContain(
      "declare const __tskm_0: __P<InferOutput<ReturnType<typeof categorySchema.build<BaseSchema<Sentinel_0, Sentinel_0>>>>>",
    )
    expect(body).toContain(
      "declare const __tskm_1: __P<InferOutput<ReturnType<typeof nodeSchema.build<BaseSchema<Sentinel_1, Sentinel_1>>>>>",
    )
  })

  it("anchors each marker so the resolver can locate it by string position", () => {
    const { body, markers } = buildSentinelQuery("./x", [{ exportName: "xSchema", typeName: "X" }])
    const anchor = `declare const ${markers[0]}`
    expect(body.indexOf(anchor)).toBeGreaterThan(-1)
  })
})

describe("substituteSentinel — token substitution + integrity guards", () => {
  it("substitutes the sentinel back-edge with the alias name (whole word)", () => {
    const out = substituteSentinel(
      "{ name: string; age: number; children: Sentinel_0[] }",
      0,
      "Category",
      true,
    )
    expect(out.failure).toBeUndefined()
    expect(out.typeString).toBe("{ name: string; age: number; children: Category[] }")
  })

  it("substitutes multiple self positions", () => {
    const out = substituteSentinel(
      "{ left: Sentinel_0 | undefined; right: Sentinel_0 | undefined }",
      0,
      "Tree",
      true,
    )
    expect(out.typeString).toBe("{ left: Tree | undefined; right: Tree | undefined }")
  })

  it("never rewrites inside a user string literal", () => {
    const out = substituteSentinel(
      '{ tag: "Sentinel_0"; next: Sentinel_0 | undefined }',
      0,
      "Node",
      true,
    )
    expect(out.typeString).toBe('{ tag: "Sentinel_0"; next: Node | undefined }')
  })

  it("fails closed when a self-referential root lost its sentinel (recursion vanished)", () => {
    const out = substituteSentinel("{ name: string }", 0, "Category", true)
    expect(out.typeString).toBeUndefined()
    expect(out.failure).toContain("sentinel")
  })

  it("accepts a sentinel-free unroll for a root that never references self", () => {
    const out = substituteSentinel("{ name: string }", 0, "Plain", false)
    expect(out.typeString).toBe("{ name: string }")
  })

  it("fails closed when a FOREIGN sentinel leaks into the output", () => {
    const out = substituteSentinel("{ a: Sentinel_0; b: Sentinel_1 }", 0, "A", true)
    expect(out.typeString).toBeUndefined()
    expect(out.failure).toContain("artifact")
  })

  it("fails closed when the unique-symbol marker text surfaces (sentinel expanded)", () => {
    const out = substituteSentinel(
      '{ self: { readonly [SENTINEL_0]: "__TskmSentinel_0__" } }',
      0,
      "X",
      true,
    )
    expect(out.typeString).toBeUndefined()
    expect(out.failure).toContain("artifact")
  })
})
