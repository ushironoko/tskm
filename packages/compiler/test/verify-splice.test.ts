import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { StructuralResolution } from "../src/structural-resolve.ts"
import { resolveSentinelUnroll } from "../src/tier1.ts"
import {
  FAILURE_TYPE_FLAGS,
  type FileDiagnostic,
  type ResolvedType,
  type TsgoClient,
} from "../src/tsgo-client.ts"
import { applyTier1, crossCheckDataKeys, rootLevelKeys } from "../src/verify-splice.ts"

// `applyTier1`, `resolveSentinelUnroll`, and `verifyFixpoint` WRITE real query/probe
// files next to `sourceFileAbs` and clean them up in `finally`. Every case must run
// against a real on-disk directory so those writes land and the cleanup observably
// fires — a mkdtemp dir per test, torn down in afterAll.
const tmpDirs: string[] = []
const mkSourceDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "tskm-verify-splice-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

// A non-failure type-flags value (Object) — anything NOT masked by FAILURE_TYPE_FLAGS
// so the R6 failure-flag guard in resolveSentinelUnroll lets the text through.
const OK_FLAGS = 524288

/** A duck-typed structural resolution; only the fields applyTier1 reads matter. */
const resolution = (over: Partial<StructuralResolution>): StructuralResolution => ({
  typeName: "Node",
  exportName: "nodeSchema",
  skeleton: "{ id: string; next: Node }",
  bearsOpaque: true,
  opaquePaths: [],
  dataKeys: ["id"],
  warnings: [],
  ...over,
})

/**
 * A scriptable stub of the live tsgo client. `resolveTypeAt` and `getDiagnostics`
 * are scripted per case; `updateFile`/`close` are no-ops. A call counter lets the
 * bearsOpaque:false case assert the client is never touched.
 */
const stubClient = (script: {
  resolveTypeAt?: (file: string, position: number) => ResolvedType | null
  getDiagnostics?: (probeFileAbs: string) => ReadonlyArray<FileDiagnostic>
}): { client: TsgoClient; calls: () => number } => {
  let calls = 0
  const resolveTypeAt = (file: string, position: number): ResolvedType | null => {
    calls++
    return script.resolveTypeAt ? script.resolveTypeAt(file, position) : null
  }
  const client: TsgoClient = {
    updateFile: () => {
      calls++
    },
    updateFiles: () => {
      calls++
    },
    // Disk path: supportsOverlay false keeps withQueryFile writing real query files, so the
    // overlay members are never reached and the call counter matches the historical disk flow.
    supportsOverlay: false,
    applyOverlay: () => {},
    clearOverlay: () => {},
    // Batched callers go through withSnapshot; drive resolveAt through the same
    // scripted resolveTypeAt so the call counter and results are unchanged.
    withSnapshot: (fn) => fn(resolveTypeAt),
    resolveTypeAt,
    getDiagnostics: (probeFileAbs) => {
      calls++
      return script.getDiagnostics ? script.getDiagnostics(probeFileAbs) : []
    },
    close: () => {
      calls++
    },
  }
  return { client, calls: () => calls }
}

describe("crossCheckDataKeys — structural-vs-checker brand-absorption gate", () => {
  it("rejects when an intersection absorbed the body (zero data-key overlap)", () => {
    // `A & { readonly "~brand": "Node" }` is the canonical lib-bug shape: the object
    // body was swallowed by the brand intersection, so NONE of the structural data
    // keys survive in the checker's rendering. This is the one corruption the oracle
    // passes vacuously, so the cross-check must catch it.
    const verdict = crossCheckDataKeys('A & { readonly "~brand": "Node" }', ["id", "parent"])
    expect(verdict.sound).toBe(false)
    expect(verdict.reason).toMatch(/intersection absorption/)
  })

  it("accepts when at least one structural data key is present in the candidate", () => {
    const verdict = crossCheckDataKeys("{ id: string; parent: Node | null }", ["id", "parent"])
    expect(verdict.sound).toBe(true)
    expect(verdict.reason).toBeUndefined()
  })

  it("is vacuously sound when the walk recorded no own data keys", () => {
    // No structural keys to compare against (e.g. a root that is a pure union/array),
    // so the cross-check has nothing to assert and defers entirely to the oracle.
    const verdict = crossCheckDataKeys('A & { readonly "~brand": "Node" }', [])
    expect(verdict.sound).toBe(true)
  })
})

describe("applyTier1 — the two emission gates, end to end with a stub client", () => {
  let dir: string
  let sourceFileAbs: string

  beforeEach(() => {
    dir = mkSourceDir()
    sourceFileAbs = join(dir, "node.schema.ts")
  })

  it("(a) cross-check rejects an intersection-absorbed unroll; no upgrade", () => {
    // The unroll renders the body absorbed into a brand intersection: after sentinel
    // substitution it carries the alias but NONE of the data keys, so the data-key
    // cross-check fails closed and the structural skeleton is kept.
    const { client } = stubClient({
      resolveTypeAt: () => ({ text: 'Sentinel_0 & { readonly "~brand": "X" }', flags: OK_FLAGS }),
    })
    const out = applyTier1(client, sourceFileAbs, [
      resolution({ dataKeys: ["id"], skeleton: "{ id: string; next: Node }" }),
    ])
    expect(out.upgraded.has("Node")).toBe(false)
    expect(out.upgraded.size).toBe(0)
    expect(out.diagnostics.some((d) => /rejected.*intersection absorption.*skeleton/.test(d))).toBe(
      true,
    )
  })

  it("(b) oracle rejects a candidate the checker flags with TS2322; no upgrade", () => {
    // Unroll passes the cross-check (it carries the `id` data key), so the fixpoint
    // oracle runs — and its probe file reports TS2322 (a wrong transform output), so
    // the candidate is rejected and the skeleton kept.
    const { client } = stubClient({
      resolveTypeAt: () => ({ text: "{ id: string; next: Sentinel_0 }", flags: OK_FLAGS }),
      getDiagnostics: (probeFileAbs) => [{ code: 2322, fileName: probeFileAbs }],
    })
    const out = applyTier1(client, sourceFileAbs, [
      resolution({ dataKeys: ["id"], skeleton: "{ id: string; next: Node }" }),
    ])
    expect(out.upgraded.size).toBe(0)
    expect(out.diagnostics.some((d) => /rejected.*fixpoint oracle.*TS2322.*skeleton/.test(d))).toBe(
      true,
    )
  })

  it("(c) a per-target unroll miss emits the 'did not resolve' diagnostic and skips", () => {
    // resolveTypeAt yields no type for this target: resolveSentinelUnroll records the
    // miss and applyTier1 leaves the target untouched (no substitution attempted).
    const { client } = stubClient({
      resolveTypeAt: () => null,
    })
    const out = applyTier1(client, sourceFileAbs, [
      resolution({ dataKeys: ["id"], skeleton: "{ id: string; next: Node }" }),
    ])
    expect(out.upgraded.size).toBe(0)
    expect(out.diagnostics.some((d) => /did not resolve/.test(d))).toBe(true)
  })

  it("(d) happy path: both gates pass; the substituted body is upgraded", () => {
    // Same unroll as (b) but the oracle probe is clean (zero diagnostics), so the
    // candidate is emitted with the sentinel back-edge rewritten to the alias.
    const { client } = stubClient({
      resolveTypeAt: () => ({ text: "{ id: string; next: Sentinel_0 }", flags: OK_FLAGS }),
      getDiagnostics: () => [],
    })
    const out = applyTier1(client, sourceFileAbs, [
      resolution({ dataKeys: ["id"], skeleton: "{ id: string; next: Node }" }),
    ])
    expect(out.upgraded.get("Node")).toBe("{ id: string; next: Node }")
    expect(out.diagnostics).toEqual([])
  })

  it("(e) bearsOpaque:false resolutions are filtered out before any client call", () => {
    // No transform-bearing target -> applyTier1 short-circuits and never touches the
    // client; the counter proves zero unroll/oracle work was done.
    const { client, calls } = stubClient({
      resolveTypeAt: () => ({ text: "{ id: string }", flags: OK_FLAGS }),
    })
    const out = applyTier1(client, sourceFileAbs, [resolution({ bearsOpaque: false })])
    expect(out.upgraded.size).toBe(0)
    expect(out.diagnostics).toEqual([])
    expect(calls()).toBe(0)
  })

  it("(f) substitution failure (residual sentinel artifact) rejects before the gates", () => {
    // The unroll leaks a FOREIGN sentinel (`Sentinel_1`) that this target's
    // substitution (index 0) cannot rewrite, so substituteSentinel fails closed on
    // the artifact check — applyTier1 emits the candidate-rejected diagnostic and
    // never reaches the cross-check or oracle.
    const { client } = stubClient({
      resolveTypeAt: () => ({
        text: "{ id: string; next: Sentinel_0; other: Sentinel_1 }",
        flags: OK_FLAGS,
      }),
      getDiagnostics: () => [],
    })
    const out = applyTier1(client, sourceFileAbs, [
      resolution({ dataKeys: ["id"], skeleton: "{ id: string; next: Node }" }),
    ])
    expect(out.upgraded.size).toBe(0)
    expect(out.diagnostics.some((d) => /candidate for Node rejected.*skeleton/.test(d))).toBe(true)
  })

  it("cleans up its query/probe files after a happy-path run", () => {
    // Both the Tier-1 query sidecar and the oracle probe must be removed by the
    // finally blocks regardless of verdict — leftover .tskm-query.ts files would be
    // picked up by the next compile.
    const { client } = stubClient({
      resolveTypeAt: () => ({ text: "{ id: string; next: Sentinel_0 }", flags: OK_FLAGS }),
      getDiagnostics: () => [],
    })
    applyTier1(client, sourceFileAbs, [
      resolution({ dataKeys: ["id"], skeleton: "{ id: string; next: Node }" }),
    ])
    // Directory should hold only the (non-existent) source; no sidecars survive.
    const leftovers = existsSync(dir) ? readdirSync(dir) : []
    expect(leftovers.filter((f) => f.includes("tskm-query"))).toEqual([])
  })
})

describe("resolveSentinelUnroll — R6 failure-flag guard", () => {
  it("reports 'did not resolve (flags=1)' when the checker returns `any`", () => {
    // flags=1 is the Any bit inside FAILURE_TYPE_FLAGS: a schema with a type error
    // resolves to `any` rather than throwing, so this MUST be treated as a miss and
    // never substituted into the emitted type.
    expect(FAILURE_TYPE_FLAGS & 1).toBe(1)
    const dir = mkSourceDir()
    const sourceFileAbs = join(dir, "node.schema.ts")
    const { client } = stubClient({
      resolveTypeAt: () => ({ text: "x", flags: 1 }),
    })
    const result = resolveSentinelUnroll(client, sourceFileAbs, [
      { exportName: "nodeSchema", typeName: "Node" },
    ])
    expect(result.unrolled.size).toBe(0)
    expect(result.diagnostics.some((d) => /did not resolve.*flags=1/.test(d))).toBe(true)
  })
})

describe("crossCheckDataKeys — root-level discrimination (spec counterexamples)", () => {
  it("rejects when the only data-key match is NESTED (proves nothing about the root)", () => {
    // The absorbed candidate carries a coincidental nested `meta.id`; the ROOT body
    // is gone. A depth-blind matcher would pass this — the gate must not.
    const verdict = crossCheckDataKeys("Brand & { meta: { id: string } }", ["id"])
    expect(verdict.sound).toBe(false)
    expect(verdict.reason).toMatch(/root level/)
  })

  it("rejects a body-dropped brand carrying only nested survivors", () => {
    const verdict = crossCheckDataKeys('{ readonly "~brand": "Node"; meta: { id: string } }', [
      "id",
      "score",
      "parent",
    ])
    expect(verdict.sound).toBe(false)
  })

  it("accepts a root-level member of an intersection of object literals", () => {
    const verdict = crossCheckDataKeys('{ id: string } & { readonly "~brand": "N" }', ["id"])
    expect(verdict.sound).toBe(true)
  })
})

describe("rootLevelKeys", () => {
  it("collects unquoted, quoted and readonly-modified members at depth 1", () => {
    const keys = rootLevelKeys('{ id: string; "two words": number; readonly "~brand": "X" }')
    expect(keys.has("id")).toBe(true)
    expect(keys.has("two words")).toBe(true)
    expect(keys.has("~brand")).toBe(true)
  })

  it("never collects nested keys or index-signature parameter names", () => {
    const keys = rootLevelKeys("{ meta: { id: string }; [key: string]: unknown }")
    expect(keys.has("meta")).toBe(true)
    expect(keys.has("id")).toBe(false)
    expect(keys.has("key")).toBe(false)
  })

  it("collects across every top-level intersection/union member", () => {
    const keys = rootLevelKeys("{ a: 1 } & { b: 2 } | { c: 3 }")
    expect([keys.has("a"), keys.has("b"), keys.has("c")]).toEqual([true, true, true])
  })
})

describe("applyTier1 — non-object roots bearing a brand (the attack7 hole)", () => {
  it("rejects a brand-bearing candidate when there are NO data keys to cross-check", () => {
    // Union root: dataKeys is empty (vacuous cross-check) AND brand absorption makes
    // the oracle vacuous — with both gates blind, the old code emitted a candidate
    // whose transform branch had silently dropped its body. Must fail closed now.
    const dir = mkSourceDir()
    const sourceFileAbs = join(dir, "attack.schema.ts")
    const { client } = stubClient({
      resolveTypeAt: () => ({
        text: '{ readonly "~brand": "Leaf"; } | { next: Sentinel_0; }',
        flags: OK_FLAGS,
      }),
      getDiagnostics: () => [], // the vacuous oracle would say "sound"
    })
    const out = applyTier1(client, sourceFileAbs, [
      resolution({
        typeName: "Attack",
        exportName: "attackSchema",
        dataKeys: [],
        skeleton: '{ next: Attack } | unknown & { readonly "~brand": "Leaf" }',
      }),
    ])
    expect(out.upgraded.size).toBe(0)
    expect(out.diagnostics.some((d) => /cannot be cross-checked for absorption/.test(d))).toBe(true)
  })

  it("still upgrades a brand-free union root when the oracle passes (positive control)", () => {
    const dir = mkSourceDir()
    const sourceFileAbs = join(dir, "plainunion.schema.ts")
    const { client } = stubClient({
      resolveTypeAt: () => ({
        text: "{ doubled: number; } | { next: Sentinel_0; }",
        flags: OK_FLAGS,
      }),
      getDiagnostics: () => [],
    })
    const out = applyTier1(client, sourceFileAbs, [
      resolution({
        typeName: "Plain",
        exportName: "plainSchema",
        dataKeys: [],
        skeleton: "{ doubled: unknown } | { next: Plain }",
      }),
    ])
    expect(out.upgraded.get("Plain")).toBe("{ doubled: number; } | { next: Plain; }")
    expect(out.diagnostics).toEqual([])
  })
})
