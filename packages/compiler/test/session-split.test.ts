import { describe, expect, it } from "bun:test"
import { type DiscoveredSchema, tskmCapability } from "../src/discovery.ts"
import { splitTargets } from "../src/session.ts"

const target = (name: string, recursive: boolean): DiscoveredSchema => ({
  name,
  typeName: name.charAt(0).toUpperCase() + name.slice(1),
  origin: "const",
  recursive,
  capability: tskmCapability(recursive),
})

/** An external (non-tskm) Standard Schema target — always checker-routed. */
const external = (name: string): DiscoveredSchema => ({
  name,
  typeName: name.charAt(0).toUpperCase() + name.slice(1),
  origin: "const",
  recursive: false,
  capability: {
    sourceKind: "standard",
    vendorHint: "zod",
    confidence: "candidate",
    typeResolver: "standard-checker",
    tier1Supported: false,
    inplaceSupported: false,
  },
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

  it("nameSharedSchemas off is byte-identical: a non-recursive tskm const stays checker", () => {
    const targets = [target("rec", true), target("tk", false), external("ext")]
    const { checkerTargets, structuralTargets } = splitTargets(targets, false)
    expect(checkerTargets.map((t) => t.name)).toEqual(["tk", "ext"])
    expect(structuralTargets.map((t) => t.name)).toEqual(["rec"])
  })

  it("nameSharedSchemas on adds tskm non-recursive consts to the structural path (kept on the checker too as a fallback); external stays checker-only", () => {
    const targets = [target("rec", true), target("tk", false), external("ext")]
    const { checkerTargets, structuralTargets } = splitTargets(targets, true)
    // External schemas must NEVER enter the walker. The tskm non-recursive const rides
    // BOTH paths: structural attempts the alias, the checker is the fallback type.
    expect(checkerTargets.map((t) => t.name)).toEqual(["tk", "ext"])
    expect(structuralTargets.map((t) => t.name)).toEqual(["rec", "tk"])
  })
})
