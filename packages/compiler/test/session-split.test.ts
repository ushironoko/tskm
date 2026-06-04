import { describe, expect, it } from "bun:test"
import type { DiscoveredSchema } from "../src/discovery.ts"
import { splitTargets } from "../src/session.ts"

const target = (name: string, recursive: boolean): DiscoveredSchema => ({
  name,
  typeName: name.charAt(0).toUpperCase() + name.slice(1),
  origin: "const",
  recursive,
})

describe("splitTargets — pure resolution routing", () => {
  it("routes recursive targets to the structural path and the rest to the checker", () => {
    const targets = [target("a", false), target("b", true), target("c", false)]
    const { checkerTargets, structuralTargets } = splitTargets(targets)
    expect(checkerTargets.map((t) => t.name)).toEqual(["a", "c"])
    expect(structuralTargets.map((t) => t.name)).toEqual(["b"])
  })

  it("yields ZERO structural targets for a non-recursive file (spawn-zero guarantee)", () => {
    // resolveRecursiveSchemas returns immediately on an empty target list, so an
    // empty split here PROVES no subprocess is spawned for non-recursive files —
    // asserted at the routing layer, not inferred from subprocess side effects.
    const { structuralTargets } = splitTargets([target("a", false), target("b", false)])
    expect(structuralTargets).toHaveLength(0)
  })

  it("preserves relative order within each partition", () => {
    const targets = [
      target("r1", true),
      target("p1", false),
      target("r2", true),
      target("p2", false),
    ]
    const { checkerTargets, structuralTargets } = splitTargets(targets)
    expect(checkerTargets.map((t) => t.name)).toEqual(["p1", "p2"])
    expect(structuralTargets.map((t) => t.name)).toEqual(["r1", "r2"])
  })
})
