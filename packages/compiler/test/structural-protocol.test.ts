import { describe, expect, it } from "bun:test"
import { splitCanonicalTargets } from "../src/structural-resolve.ts"
import { buildTargetIdentityMap } from "../src/worker-harness.ts"

// The worker-side identity map and the parent-side duplicate split are the two
// halves of the target-driven protocol: only declared targets can ever be named
// in a structural body, and one canonical alias exists per export binding.

const schema = (): { kind: "schema" } => ({ kind: "schema" })

describe("buildTargetIdentityMap", () => {
  it("maps only declared targets, never other module exports", () => {
    const target = schema()
    const helper = schema()
    const mod = { target, helper }
    const map = buildTargetIdentityMap(mod, [["target", "Target"]])
    expect(map.get(target)).toBe("Target")
    expect(map.has(helper)).toBe(false)
  })

  it("is canonical-first on object identity", () => {
    // Two pairs naming the SAME runtime object: the first (discovery order) wins,
    // so no body can self-reference a different declared alias.
    const obj = schema()
    const mod = { a: obj, b: obj }
    const map = buildTargetIdentityMap(mod, [
      ["a", "A"],
      ["b", "B"],
    ])
    expect(map.get(obj)).toBe("A")
  })

  it("skips pairs whose export is missing or not a schema", () => {
    const real = schema()
    const mod = { real, plain: { not: "a schema" } }
    const map = buildTargetIdentityMap(mod, [
      ["real", "Real"],
      ["plain", "Plain"],
      ["ghost", "Ghost"],
    ])
    expect(map.size).toBe(1)
    expect(map.get(real)).toBe("Real")
  })
})

describe("splitCanonicalTargets", () => {
  const target = (name: string, typeName: string) =>
    ({ name, typeName, origin: "const", recursive: true }) as const

  it("keeps distinct export bindings as canonicals", () => {
    const { canonical, duplicates } = splitCanonicalTargets([target("a", "A"), target("b", "B")])
    expect(canonical.map((t) => t.typeName)).toEqual(["A", "B"])
    expect(duplicates).toHaveLength(0)
  })

  it("turns later targets on the same binding into duplicates of the first", () => {
    // `export const nodeSchema = recursive(...)` + `export type TreeNode =
    // Infer<typeof nodeSchema>`: both targets share the binding; the const-derived
    // alias is canonical (discovery order) and the alias becomes a thin re-export.
    const { canonical, duplicates } = splitCanonicalTargets([
      target("nodeSchema", "Node"),
      target("nodeSchema", "TreeNode"),
    ])
    expect(canonical.map((t) => t.typeName)).toEqual(["Node"])
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.target.typeName).toBe("TreeNode")
    expect(duplicates[0]?.canonicalName).toBe("Node")
  })
})
