import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { DiscoveredSchema } from "../src/discovery.ts"
import { resolveRecursiveSchemas } from "../src/structural-resolve.ts"

// Parent-side driver tests over the REAL worker subprocess (resolveWorker picks
// structural-ts-worker.ts) against tiny REAL fixture modules — the degrade-safe
// branches (R6: any failure is a diagnostic + skip, never an overwrite) are only
// trustworthy when exercised against the actual worker envelope, not a stub.
//
// The fixture modules import the runtime by its bare `@tskm/core` specifier, so
// each tmp dir carries a tsconfig.json mapping that specifier to the workspace
// source (bun honors tsconfig `paths` from the entry module's cwd). The tmp dir
// lives UNDER the worktree so that mapping resolves; afterAll removes it.

function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

// Absolute path to the workspace runtime source the fixtures' `@tskm/core` maps to.
const here = dirname(fileURLToPath(import.meta.url))
const coreAbs = join(here, "..", "..", "tskm", "src", "index.ts")

// mkdtemp under the worktree (sibling of the other test dirs) so the fixtures'
// tsconfig `paths` mapping to the workspace runtime resolves under bun.
const tmpRoot = mkdtempSync(join(here, "structural-resolve-tmp-"))

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    paths: { "@tskm/core": [coreAbs] },
  },
})

/**
 * Writes one fixture module + its tsconfig into a fresh subdir of the tmp root and
 * returns the absolute module path. The tsconfig is what lets bun resolve the
 * fixture's bare `@tskm/core` import to the workspace runtime.
 */
let fixtureSeq = 0
function fixture(source: string): string {
  const dir = join(tmpRoot, `fx${fixtureSeq++}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG)
  const file = join(dir, "schema.ts")
  writeFileSync(file, source)
  return file
}

const target = (
  over: Partial<DiscoveredSchema> & Pick<DiscoveredSchema, "name" | "typeName">,
): DiscoveredSchema => ({
  origin: "const",
  recursive: true,
  ...over,
})

describe.skipIf(!bun)("resolveRecursiveSchemas — degrade-safe branches (real worker)", () => {
  // The worker runs with cwd = the fixture dir (options.root) so bun discovers that
  // dir's tsconfig and resolves `@tskm/core`. timeoutMs is generous: a cold bun
  // subprocess importing the runtime can take a beat on CI.
  const options = (root: string) => ({ root, execPath: bun as string, timeoutMs: 30000 })

  it("WORKER FAILURE: an unspawnable execPath yields no resolutions and a 'worker failed' diagnostic", () => {
    // L97: runWorker collapses a spawn error to a single diagnostic; the driver
    // returns empty resolutions so the caller writes nothing (existing output kept).
    const file = fixture(
      `import { object, optional, recursive } from "@tskm/core"\n` +
        `export const nodeSchema = recursive((self) => object({ next: optional(self) }))\n`,
    )
    const result = resolveRecursiveSchemas(
      file,
      [target({ name: "nodeSchema", typeName: "Node" })],
      {
        root: dirname(file),
        execPath: "/no/such/binary",
        timeoutMs: 30000,
      },
    )
    expect(result.resolutions).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatch(/worker failed/)
  }, 30_000)

  it("NOT FOUND: a target whose export is absent is skipped with a 'not found among module exports' diagnostic", () => {
    // L110-113: the worker only emits entries for exports it sees; a target naming a
    // missing const has no entry, so it must skip (not crash) and say so precisely.
    const file = fixture(
      `import { object, optional, recursive } from "@tskm/core"\n` +
        `export const nodeSchema = recursive((self) => object({ next: optional(self) }))\n`,
    )
    const result = resolveRecursiveSchemas(
      file,
      [target({ name: "ghost", typeName: "Ghost" })],
      options(dirname(file)),
    )
    expect(result.resolutions).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatch(/not found among module exports.*is the const exported/)
  }, 30_000)

  it("NOT RECURSIVE AT RUNTIME: a flagged-recursive target whose runtime object is plain is skipped", () => {
    // L119-122: discovery flagged it syntactically but the runtime object is not a
    // recursive() root — degrade-safe skip rather than emit a wrong skeleton.
    const file = fixture(
      `import { object } from "@tskm/core"\n` + `export const plainSchema = object({})\n`,
    )
    const result = resolveRecursiveSchemas(
      file,
      [target({ name: "plainSchema", typeName: "Plain", recursive: true })],
      options(dirname(file)),
    )
    expect(result.resolutions).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatch(
      /flagged recursive but its runtime object is not a recursive\(\) schema/,
    )
  }, 30_000)

  it("THIN RE-EXPORT: a duplicate declared alias is emitted as a re-export of its resolved canonical", () => {
    // L149-160: two targets share the export binding nodeSchema. splitCanonicalTargets
    // makes Node canonical (discovery order) and TreeNode a duplicate; once Node
    // resolves, TreeNode is emitted as `type TreeNode = Node` (skeleton === canonical
    // name, no opaque carry-over) plus the re-export diagnostic.
    const file = fixture(
      `import { object, optional, recursive } from "@tskm/core"\n` +
        `export const nodeSchema = recursive((self) => object({ next: optional(self) }))\n`,
    )
    const result = resolveRecursiveSchemas(
      file,
      [
        target({ name: "nodeSchema", typeName: "Node" }),
        target({ name: "nodeSchema", typeName: "TreeNode", origin: "alias" }),
      ],
      options(dirname(file)),
    )

    const treeNode = result.resolutions.find((r) => r.typeName === "TreeNode")
    expect(treeNode).toBeDefined()
    // The re-export carries the canonical name as its body and no opaque baggage.
    expect(treeNode?.skeleton).toBe("Node")
    expect(treeNode?.bearsOpaque).toBe(false)
    // The canonical Node still resolves to a real structural body alongside it.
    const node = result.resolutions.find((r) => r.typeName === "Node")
    expect(node?.skeleton).toContain("next: Node | undefined")

    expect(
      result.diagnostics.some((d) =>
        /duplicates the alias.*emitted as a re-export of Node/.test(d),
      ),
    ).toBe(true)
  }, 30_000)

  it("CANONICAL-MISSING SKIP: a duplicate is skipped when its canonical alias could not be resolved", () => {
    // L143-148: both targets name the missing export `ghost`. A (canonical) hits the
    // not-found branch; B (duplicate of A) cannot be emitted because A never landed in
    // resolvedNames, so B reports the canonical-missing skip instead of dangling.
    const file = fixture(
      `import { object, optional, recursive } from "@tskm/core"\n` +
        `export const nodeSchema = recursive((self) => object({ next: optional(self) }))\n`,
    )
    const result = resolveRecursiveSchemas(
      file,
      [target({ name: "ghost", typeName: "A" }), target({ name: "ghost", typeName: "B" })],
      options(dirname(file)),
    )

    expect(result.resolutions).toEqual([])
    // A: the canonical, missing from module exports.
    expect(
      result.diagnostics.some((d) => /not found among module exports/.test(d) && d.includes("A")),
    ).toBe(true)
    // B: the duplicate, blocked because canonical A could not be resolved.
    expect(
      result.diagnostics.some((d) => /whose canonical alias A could not be resolved/.test(d)),
    ).toBe(true)
  }, 30_000)
})
