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
  "dupname.schema.gen.ts",
  "selfalias.schema.gen.ts",
  "keyclash.schema.gen.ts",
  "leaf.schema.tskm-query.ts",
  "reexport.schema.tskm-query.ts",
  "crossalias.schema.tskm-query.ts",
  "specifier.schema.tskm-query.ts",
  "orphan.schema.tskm-query.ts",
  "optnull.schema.tskm-query.ts",
  "dupname.schema.tskm-query.ts",
  "selfalias.schema.tskm-query.ts",
  "keyclash.schema.tskm-query.ts",
  "keyclash.schema.tier1.tskm-query.ts",
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

    // Only the sound roots emit: Leaf, OptNull, SpecNode, User (dupname),
    // Book (selfalias), Clash (keyclash).
    expect(result.files.length).toBe(6)

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

    // Duplicate derived typeName (`user` + `userSchema` -> User): the FIRST
    // declaration wins, the later one is skipped with a diagnostic — never a
    // renderSidecar crash that aborts the whole run.
    const dupGen = readFileSync(src("dupname.schema.gen.ts"), "utf8")
    expect(dupGen).toContain("export type User = {")
    expect(dupGen).toContain("boss: User | undefined")
    expect(dupGen).not.toContain("parent:")
    expect(
      result.diagnostics.some(
        (d) => d.includes('duplicate generated type name "User"') && d.includes("userSchema"),
      ),
    ).toBe(true)

    // The canonical const+Infer-alias pair: exactly ONE Book, never a circular
    // `type Book = Book` thin re-export.
    const selfGen = readFileSync(src("selfalias.schema.gen.ts"), "utf8")
    expect(selfGen).toContain("export type Book = {")
    expect(selfGen).toContain("sequel: Book | undefined")
    expect(selfGen).not.toContain("Book = Book")
    expect(selfGen.match(/export type Book/g)).toHaveLength(1)

    // A property KEY named like a failing sibling alias must not get the sound
    // Tier-1 root pruned: the key is a member declaration, not a type reference.
    const clashGen = readFileSync(src("keyclash.schema.gen.ts"), "utf8")
    expect(clashGen).toContain("export type Clash = {")
    expect(clashGen).toContain("CategoryTree: string")
    expect(clashGen).toContain("value: number")
    expect(result.diagnostics.some((d) => d.includes("skipping Clash"))).toBe(false)
    // ...while the failing sibling itself is honestly skipped.
    expect(existsSync(src("categoryTree.schema.gen.ts"))).toBe(false)
    expect(
      result.diagnostics.some(
        (d) => d.includes("no declared alias") && d.includes("CategoryTree.entries[inner]"),
      ),
    ).toBe(true)
  }, 180_000)

  it("KEYSTONE: emitted aliases type-check and reject missing keys", () => {
    writeFileSync(
      src("probe.check.ts"),
      `import type { Book } from "./selfalias.schema.gen.ts"
import type { User } from "./dupname.schema.gen.ts"
import type { Clash } from "./keyclash.schema.gen.ts"
import type { Leaf } from "./leaf.schema.gen.ts"
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
const book: Book = { title: "t", sequel: { title: "u", sequel: undefined } }
const user: User = { name: "u", boss: undefined }
const clash: Clash = { CategoryTree: "not a type", value: 4, kids: [] }

// Keys are REQUIRED even when their value admits undefined — a missing key must
// not type-check (this guards the k?: regression at the type level).
// @ts-expect-error 'next' is required
const bad: OptNull = { name: "b", alt: undefined, other: null }

export const probes = [leaf, spec, opt, book, user, clash, bad] as const
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
