import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"
import { runTsgoNoEmit } from "./typecheck-harness.ts"

// End-to-end over the REAL pipeline: discovery -> split -> structural worker (real
// subprocess importing the fixture module) -> merge -> sidecar emit, then the
// keystone: the generated `.gen.ts` files MUST type-check under the real tsgo
// binary together with a probe that uses them in value positions. The worker
// imports `.ts` modules with a bare `@tskm/core` import, so it needs a TS-capable
// runtime on PATH (bun), mirroring jsonschema.integration.test.ts.
const fixtureRoot = fileURLToPath(new URL("./fixtures/recursive", import.meta.url))
const src = (file: string): string =>
  fileURLToPath(new URL(`./fixtures/recursive/src/${file}`, import.meta.url))

const cleanups = [
  src("category.schema.gen.ts"),
  src("json.schema.gen.ts"),
  src("json.schema.tskm-query.ts"),
  src("mutual.schema.gen.ts"),
  src("mixed.schema.gen.ts"),
  src("category.schema.tskm-query.ts"),
  src("mutual.schema.tskm-query.ts"),
  src("mixed.schema.tskm-query.ts"),
  src("node.schema.ts"),
  src("node.schema.tskm-query.ts"),
  src("probe.check.ts"),
]

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

const PROBE = `import type { Category } from "./category.schema.gen.ts"
import type { Json } from "./json.schema.gen.ts"
import type { A, B } from "./mutual.schema.gen.ts"
import type { Stat, Tree } from "./mixed.schema.gen.ts"

// Value-level probes: the recursive aliases must accept well-formed recursive data
// in both leaf and nested positions, and the mutual pair must cross-link.
const leaf: Category = { name: "leaf", children: [] }
const root: Category = { name: "root", children: [leaf, { name: "k", children: [] }] }
const b: B = { a: undefined }
const a: A = { name: "a", b }
const linked: B = { a: { name: "a2", b: undefined } }
const tree: Tree = { label: "t", kids: [{ label: "u", kids: [] }] }
const stat: Stat = 42
const json: Json = { items: [1, "two", true, null], nested: { deep: [{}] } }

export const probes = [root, a, linked, tree, stat, json] as const
`

describe.skipIf(!bun)("recursive structural codegen (real tsgo + real worker)", () => {
  it("materializes self-recursive, mutual and mixed schemas into sidecars", async () => {
    const result = await generate({
      root: fixtureRoot,
      config: {
        mode: "sidecar",
        include: ["src/*.schema.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: bun },
      },
    })

    expect(result.files.length).toBe(4)

    const categoryGen = readFileSync(src("category.schema.gen.ts"), "utf8")
    expect(categoryGen).toContain("export type Category = {")
    expect(categoryGen).toContain("children: Category[]")

    const mutualGen = readFileSync(src("mutual.schema.gen.ts"), "utf8")
    expect(mutualGen).toContain("export type A = {")
    expect(mutualGen).toContain("b?: B | undefined")
    expect(mutualGen).toContain("export type B = {")
    expect(mutualGen).toContain("a?: A | undefined")

    // JSON value: recursion through array AND record — the record position must be
    // an index-signature literal (Record<string, Json> would be TS2456).
    const jsonGen = readFileSync(src("json.schema.gen.ts"), "utf8")
    expect(jsonGen).toContain("export type Json =")
    expect(jsonGen).toContain("Json[]")
    expect(jsonGen).toContain("[key: string]: Json")
    expect(jsonGen).not.toContain("Record<string, Json>")

    // Mixed file: ONE sidecar carrying both paths — the structural skeleton and the
    // checker-resolved transform output (transform's output is typed by tsgo).
    const mixedGen = readFileSync(src("mixed.schema.gen.ts"), "utf8")
    expect(mixedGen).toContain("export type Tree = {")
    expect(mixedGen).toContain("kids: Tree[]")
    expect(mixedGen).toContain("export type Stat = number")
  }, 120_000)

  it("KEYSTONE: the generated aliases type-check under real tsgo with a value probe", () => {
    writeFileSync(src("probe.check.ts"), PROBE)
    const check = runTsgoNoEmit(fixtureRoot)
    expect(check.output).not.toContain("error TS")
    expect(check.ok).toBe(true)
  }, 120_000)

  it("round-trips a RENAMED recursive Infer alias through inplace (name coherence)", async () => {
    // The alias name (TreeNode) deliberately differs from the derived name (Node):
    // the back-edge must follow DISCOVERY's typeName — the single naming source —
    // or the sentinel block would reference an undeclared type.
    const SOURCE = `import { type Infer, object, optional, recursive, string } from "@tskm/core"

export const nodeSchema = recursive((self) =>
  object({
    label: string(),
    next: optional(self),
  }),
)

export type TreeNode = Infer<typeof nodeSchema>
`
    writeFileSync(src("node.schema.ts"), SOURCE)
    const first = await generate({
      root: fixtureRoot,
      mode: "inplace",
      config: {
        include: ["src/node.schema.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: bun },
      },
    })
    expect(first.files).toHaveLength(1)
    expect(first.files[0]?.changed).toBe(true)

    const written = readFileSync(src("node.schema.ts"), "utf8")
    expect(written).toMatch(/\/\/ @tskm-gen TreeNode from nodeSchema #[0-9a-f]{8}/)
    expect(written).toContain("export type TreeNode = {")
    expect(written).toContain("next?: TreeNode | undefined")
    expect(written).toContain("// @tskm-end TreeNode")
    // The schema declaration itself is preserved verbatim.
    expect(written).toContain("export const nodeSchema = recursive((self) =>")

    // Idempotent second run: content hash matches, file untouched.
    const before = readFileSync(src("node.schema.ts"), "utf8")
    const second = await generate({
      root: fixtureRoot,
      mode: "inplace",
      config: {
        include: ["src/node.schema.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: bun },
      },
    })
    expect(second.files[0]?.changed).toBe(false)
    expect(readFileSync(src("node.schema.ts"), "utf8")).toBe(before)
  }, 120_000)

  it("leaves no query files behind", () => {
    expect(existsSync(src("category.schema.tskm-query.ts"))).toBe(false)
    expect(existsSync(src("mixed.schema.tskm-query.ts"))).toBe(false)
  })
})
