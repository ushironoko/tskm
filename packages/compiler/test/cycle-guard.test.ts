import { describe, expect, it } from "bun:test"
import { type CycleWalkHooks, createCycleGuard, walkWithCycleGuard } from "../src/cycle-guard.ts"

// The shared cycle guard hoists a revisited node into a named definition and emits a
// reference to it. Both real walkers (JSON Schema, structural TS) drive it through these
// hooks; this exercises the guard directly with a minimal in-memory hook set.

describe("walkWithCycleGuard", () => {
  it("inlines an acyclic node without hoisting", () => {
    const state = createCycleGuard()
    const defs = new Map<string, string>()
    const leaf = { id: "leaf" }
    const hooks: CycleWalkHooks<string> = {
      emitRef: (name) => `#${name}`,
      storeDef: (name, body) => void defs.set(name, body),
      hasDef: (name) => defs.has(name),
      baseName: () => "Node",
      walkBody: () => "BODY",
    }
    expect(walkWithCycleGuard(leaf, state, hooks)).toBe("BODY")
    // Nothing revisited -> nothing hoisted.
    expect(defs.size).toBe(0)
    expect(state.names.size).toBe(0)
  })

  it("hoists a self-cyclic node and returns a reference to the stored definition", () => {
    const state = createCycleGuard()
    const defs = new Map<string, string>()
    const self = { id: "self" }
    const hooks: CycleWalkHooks<string> = {
      emitRef: (name) => `#${name}`,
      storeDef: (name, body) => void defs.set(name, body),
      hasDef: (name) => defs.has(name),
      baseName: () => "Node",
      // Re-walking the same node mid-build models a containment back-edge.
      walkBody: (schema) => `body(${walkWithCycleGuard(schema, state, hooks)})`,
    }
    const out = walkWithCycleGuard(self, state, hooks)
    expect(out).toBe("#Node")
    expect(defs.get("Node")).toBe("body(#Node)")
  })

  it("disambiguates a same-base-name collision via hasName, independent of hasDef", () => {
    // Two distinct nodes both prefer the base name "Node". `hasDef` is forced to report
    // nothing, so the only thing preventing a duplicate name is the guard's own
    // `hasName(state, candidate)` scan over already-assigned names. The second node must
    // therefore fall through to the numbered "Node_2".
    const state = createCycleGuard()
    const a = { id: "a" }
    const b = { id: "b" }
    const hooks: CycleWalkHooks<string> = {
      emitRef: (name) => `#${name}`,
      storeDef: () => {},
      hasDef: () => false,
      baseName: () => "Node",
      walkBody: (schema) => walkWithCycleGuard(schema, state, hooks),
    }

    expect(walkWithCycleGuard(a, state, hooks)).toBe("#Node")
    expect(walkWithCycleGuard(b, state, hooks)).toBe("#Node_2")
    expect(state.names.get(a)).toBe("Node")
    expect(state.names.get(b)).toBe("Node_2")
  })
})
