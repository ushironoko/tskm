import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"
import { runTsgoNoEmit } from "./typecheck-harness.ts"

// End-to-end for the opt-in named-sibling-alias mode (issue #22). A shared non-recursive
// sub-schema (`addressSchema`) is referenced by several discriminated-union members. With
// the flag off it inlines at every site; with it on it is emitted once and referenced by
// name. The on output must also type-check under real tsgo.
const fixtureRoot = fileURLToPath(new URL("./fixtures/shared-alias", import.meta.url))
const src = (file: string): string =>
  fileURLToPath(new URL(`./fixtures/shared-alias/src/${file}`, import.meta.url))
const genFile = src("union.schema.gen.ts")

function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

const degradeGen = src("degrade.schema.gen.ts")

afterAll(() => {
  for (const f of [genFile, degradeGen, src("probe.check.ts")]) {
    if (existsSync(f)) rmSync(f)
  }
})

const run = (nameSharedSchemas: boolean, include = "src/union.schema.ts") =>
  generate({
    root: fixtureRoot,
    config: {
      mode: "sidecar",
      include: [include],
      tsconfig: "tsconfig.json",
      worker: { execPath: bun },
      codegen: { nameSharedSchemas },
    },
  })

describe.skipIf(!bun)("named sibling aliases (#22, real worker + tsgo)", () => {
  it("off (default): the shared sub-schema is inlined at every reference site", async () => {
    await run(false)
    const gen = readFileSync(genFile, "utf8")
    // The members inline the address shape and the union inlines its members.
    expect(gen).toContain("export type Place = {")
    expect(gen).not.toContain("export type Place = Home | Work")
    expect(gen).not.toContain("address: Address")
    rmSync(genFile)
  }, 120_000)

  it("on: the shared sub-schema is emitted once and referenced by name", async () => {
    const result = await run(true)
    expect(result.files.length).toBe(1)
    const gen = readFileSync(genFile, "utf8")
    expect(gen).toContain("export type Address = {")
    // References resolve to the alias name instead of re-expanding the shape.
    expect(gen).toContain("address: Address")
    expect(gen).toContain("export type Place = Home | Work")
    // The address body appears exactly once (the alias declaration), not at each site.
    expect(gen.match(/street: string/g)?.length).toBe(1)
  }, 120_000)

  it("KEYSTONE: the on output type-checks under real tsgo with a value probe", () => {
    writeFileSync(
      src("probe.check.ts"),
      `import type { Address, Home, Place } from "./union.schema.gen.ts"

const addr: Address = { street: "a", city: "b" }
const home: Home = { kind: "home", address: addr }
const place: Place = home
export const probes = [addr, home, place] as const
`,
    )
    const check = runTsgoNoEmit(fixtureRoot)
    expect(check.output).not.toContain("error TS")
    expect(check.ok).toBe(true)
  }, 120_000)

  it("on: falls back to the checker for shapes the walker cannot alias, and never emits a blank/unknown alias", async () => {
    await run(true, "src/degrade.schema.ts")
    const gen = readFileSync(degradeGen, "utf8")
    // A transform's output type comes from the checker, NOT the walker's `unknown` floor.
    expect(gen).toContain("export type Len = number")
    expect(gen).not.toContain("Len = unknown")
    // A non-schema tskm const (`parse(...)`) produces no alias (no invalid `export type X =`).
    expect(gen).not.toContain("export type Parsed")
    // A const + same-binding `Infer` alias folds to a thin re-export over the named body.
    expect(gen).toContain("export type Tag = {")
    expect(gen).toContain("export type TagAlias = Tag")
  }, 120_000)
})
