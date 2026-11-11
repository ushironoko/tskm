import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"
import { afterAll, describe, expect, it } from "./test-api.ts"
import { withTestTsgo } from "./tsgo-test-executable.ts"
import { runTsgoNoEmit } from "./typecheck-harness.ts"

// End-to-end for named sibling aliases (issue #22, and issue #59 for the default). A shared
// non-recursive sub-schema (`addressSchema`) is referenced by several discriminated-union
// members. It is emitted once and referenced by name: by default through the named-parts pass,
// and with `nameSharedSchemas` through the structural walker. Both outputs must also type-check
// under real tsgo.
const fixtureRoot = fileURLToPath(new URL("./fixtures/shared-alias", import.meta.url))
const src = (file: string): string =>
  fileURLToPath(new URL(`./fixtures/shared-alias/src/${file}`, import.meta.url))
const genFile = src("union.schema.gen.ts")

const degradeGen = src("degrade.schema.gen.ts")

afterAll(() => {
  for (const f of [genFile, degradeGen, src("probe.check.ts")]) {
    if (existsSync(f)) rmSync(f)
  }
})

const run = (nameSharedSchemas: boolean, include = "src/union.schema.ts") =>
  generate({
    root: fixtureRoot,
    config: withTestTsgo({
      mode: "sidecar",
      include: [include],
      tsconfig: "tsconfig.json",
      worker: { execPath: process.execPath },
      codegen: { nameSharedSchemas },
    }),
  })

describe("named sibling aliases (#22, real worker + tsgo)", () => {
  it("off (default): the shared sub-schema is still named, by the named-parts pass", async () => {
    // The default needs no flag: a shared object part is referenced by name (named-parts.ts).
    // The walker flag below is a separate, opt-in route to the same names.
    await run(false)
    const gen = readFileSync(genFile, "utf8")
    expect(gen).toContain("export type Address = {")
    expect(gen).toContain("address: Address")
    expect(gen).toContain("export type Place = Home | Work")
    expect(gen.match(/street: string/g)?.length).toBe(1)
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
    // A `fallback()` (a type the walker cannot render) likewise resolves to the checker type,
    // never overwriting the correct `string` with the walker's `unknown` floor (issue #22).
    expect(gen).toContain("export type SafeName = string")
    expect(gen).not.toContain("SafeName = unknown")
    // A non-schema tskm const (`parse(...)`) produces no alias (no invalid `export type X =`).
    expect(gen).not.toContain("export type Parsed")
    // A const + same-binding `Infer` alias folds to a thin re-export over the named body.
    expect(gen).toContain("export type Tag = {")
    expect(gen).toContain("export type TagAlias = Tag")
  }, 120_000)
})
