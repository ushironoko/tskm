import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"
import { runTsgoNoEmit } from "./typecheck-harness.ts"

// Edge contracts of the structural path, end-to-end over the real pipeline:
// - re-exported imported recursive schemas fail CLOSED (no dangling alias, no
//   foreign inline) — the identity map is target-driven;
// - cross-file `Infer<typeof imported>` aliases fail CLOSED on the checker path
//   (flags=1 caught by FAILURE_TYPE_FLAGS) — regression lock for the probe result;
// - the dangling-alias prune cascades when a declared sibling is skipped;
// - specifier-form exports (`export { node }`) are a supported authoring surface;
// - optional/nullish keys stay REQUIRED with the union on the value.
const fixtureRoot = fileURLToPath(new URL("./fixtures/recursive-edge", import.meta.url))
const src = (file: string): string =>
  fileURLToPath(new URL(`./fixtures/recursive-edge/src/${file}`, import.meta.url))

const cleanups = [
  "leaf.schema.gen.ts",
  "reexport.schema.gen.ts",
  "crossalias.schema.gen.ts",
  "specifier.schema.gen.ts",
  "orphan.schema.gen.ts",
  "optnull.schema.gen.ts",
  "leaf.schema.tskm-query.ts",
  "reexport.schema.tskm-query.ts",
  "crossalias.schema.tskm-query.ts",
  "specifier.schema.tskm-query.ts",
  "orphan.schema.tskm-query.ts",
  "optnull.schema.tskm-query.ts",
  "probe.check.ts",
].map(src)

function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

afterAll(() => {
  for (const f of cleanups) {
    if (existsSync(f)) rmSync(f)
  }
})

describe.skipIf(!bun)("structural edge contracts (real tsgo + real worker)", () => {
  it("fails closed instead of dangling, and keeps keys required", async () => {
    const result = await generate({
      root: fixtureRoot,
      config: {
        mode: "sidecar",
        include: ["src/*.schema.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: bun },
      },
    })

    // Only the sound roots emit: Leaf, OptNull, SpecNode.
    expect(result.files.length).toBe(3)

    // Defining file: normal emission.
    const leafGen = readFileSync(src("leaf.schema.gen.ts"), "utf8")
    expect(leafGen).toContain("export type Leaf = {")
    expect(leafGen).toContain("next: Leaf | undefined")

    // Re-export: treeSchema referenced an imported recursive schema — skip with a
    // path-precise diagnostic; NO .gen.ts, no dangling `Leaf` reference, no inline.
    expect(existsSync(src("reexport.schema.gen.ts"))).toBe(false)
    expect(
      result.diagnostics.some(
        (d) => d.includes("no declared alias") && d.includes(".entries[leaf]"),
      ),
    ).toBe(true)

    // Cross-file alias: the checker path rejects the collapsed unroll (flags=1).
    expect(existsSync(src("crossalias.schema.gen.ts"))).toBe(false)
    expect(
      result.diagnostics.some((d) => d.includes("leafSchema") && d.includes("skipping CrossLeaf")),
    ).toBe(true)

    // Orphan cascade: Broken hits the non-target helper (skip), so Main's
    // legitimate `Broken` reference dangles and the prune must drop Main too.
    expect(existsSync(src("orphan.schema.gen.ts"))).toBe(false)
    expect(
      result.diagnostics.some(
        (d) => d.includes("no declared alias") && d.includes(".entries[inner]"),
      ),
    ).toBe(true)
    expect(result.diagnostics.some((d) => d.includes('"Main"') && d.includes('"Broken"'))).toBe(
      true,
    )

    // Specifier-form export: a supported authoring surface.
    const specGen = readFileSync(src("specifier.schema.gen.ts"), "utf8")
    expect(specGen).toContain("export type SpecNode = {")
    expect(specGen).toContain("next: SpecNode | undefined")

    // optional/nullish/nullable keys: required, union on the value.
    const optGen = readFileSync(src("optnull.schema.gen.ts"), "utf8")
    expect(optGen).toContain("next: OptNull | undefined")
    expect(optGen).toContain("alt: OptNull | null | undefined")
    expect(optGen).toContain("other: OptNull | null")
    expect(optGen).not.toContain("?:")
  }, 180_000)

  it("KEYSTONE: emitted aliases type-check and reject missing keys", () => {
    writeFileSync(
      src("probe.check.ts"),
      `import type { Leaf } from "./leaf.schema.gen.ts"
import type { OptNull } from "./optnull.schema.gen.ts"
import type { SpecNode } from "./specifier.schema.gen.ts"

const leaf: Leaf = { name: "l", next: { name: "n", next: undefined } }
const spec: SpecNode = { label: "s", next: undefined }
const opt: OptNull = {
  name: "o",
  next: { name: "i", next: undefined, alt: null, other: null },
  alt: undefined,
  other: null,
}

// Keys are REQUIRED even when their value admits undefined — a missing key must
// not type-check (this guards the k?: regression at the type level).
// @ts-expect-error 'next' is required
const bad: OptNull = { name: "b", alt: undefined, other: null }

export const probes = [leaf, spec, opt, bad] as const
`,
    )
    const check = runTsgoNoEmit(fixtureRoot)
    expect(check.output).not.toContain("error TS")
    expect(check.ok).toBe(true)
  }, 120_000)

  it("leaves no query files behind", () => {
    expect(existsSync(src("reexport.schema.tskm-query.ts"))).toBe(false)
    expect(existsSync(src("orphan.schema.tskm-query.ts"))).toBe(false)
  })
})
