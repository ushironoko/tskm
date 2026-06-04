import { describe, expect, it } from "bun:test"
import { type PruneCandidate, pruneDanglingAliases } from "../src/prune.ts"

const c = (typeName: string, body: string, structural = true): PruneCandidate => ({
  typeName,
  body,
  structural,
})

describe("pruneDanglingAliases", () => {
  it("keeps bodies whose sibling references are all emitted", () => {
    const result = pruneDanglingAliases(
      [c("A", "{ b: B | undefined }"), c("B", "{ a: A | undefined }")],
      new Set(["A", "B"]),
    )
    expect(result.kept.map((k) => k.typeName)).toEqual(["A", "B"])
    expect(result.diagnostics).toHaveLength(0)
  })

  it("drops a body referencing a declared-but-not-emitted alias", () => {
    // `Broken` was declared (a target) but its resolution failed — `Main` would
    // dangle, so it must be dropped with a diagnostic.
    const result = pruneDanglingAliases(
      [c("Main", "{ broken: Broken; next: Main | undefined }")],
      new Set(["Main", "Broken"]),
    )
    expect(result.kept).toHaveLength(0)
    expect(result.diagnostics[0]).toContain('"Main"')
    expect(result.diagnostics[0]).toContain('"Broken"')
  })

  it("cascades to a fixpoint when dropping one body dangles another", () => {
    // C -> B -> A where A is missing: dropping B must then drop C.
    const result = pruneDanglingAliases(
      [c("B", "{ a: A }"), c("C", "{ b: B }")],
      new Set(["A", "B", "C"]),
    )
    expect(result.kept).toHaveLength(0)
    expect(result.diagnostics).toHaveLength(2)
  })

  it("ignores alias names inside string literals (quote-aware)", () => {
    const result = pruneDanglingAliases(
      [c("Tag", '{ kind: "Missing"; next: Tag | undefined }')],
      new Set(["Tag", "Missing"]),
    )
    expect(result.kept.map((k) => k.typeName)).toEqual(["Tag"])
  })

  it("does not treat a whole-word superset as a reference", () => {
    const result = pruneDanglingAliases(
      [c("List", "{ items: ListItemX[] }")],
      new Set(["List", "ListItem"]),
    )
    expect(result.kept.map((k) => k.typeName)).toEqual(["List"])
  })

  it("never scans checker bodies (a coincidental match must not drop them)", () => {
    const result = pruneDanglingAliases(
      [c("Meta", "{ broken: Broken }", false)],
      new Set(["Meta", "Broken"]),
    )
    expect(result.kept.map((k) => k.typeName)).toEqual(["Meta"])
  })

  it("self-references are not dangling", () => {
    const result = pruneDanglingAliases([c("Tree", "{ kids: Tree[] }")], new Set(["Tree"]))
    expect(result.kept.map((k) => k.typeName)).toEqual(["Tree"])
  })
})
