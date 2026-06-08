import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"
import { runTsgoNoEmit } from "./typecheck-harness.ts"

// Anti-corruption layer (re-export hub) contracts, end-to-end over the real pipeline.
// A project authors schemas against `@validator` (which re-exports @tskm/core) and
// never imports @tskm/core directly. The compiler must still:
//   - Scenario A: route a hub-imported recursive() ROOT to the structural walker and
//     materialize the correct self-referential alias (NOT a checker partial whose
//     self positions degraded to `any`);
//   - Scenario B: keep the cross-file fail-closed contract — a declared hub-recursive
//     root that references an IMPORTED recursive child still skips with a diagnostic
//     (no dangling alias, no foreign inline).
//
// Prerequisite: the hub (`@validator`) is registered in `schemaSources`. Without it the
// hub schemas are not discovered at all (the import specifier never matches a source).
const fixtureRoot = fileURLToPath(new URL("./fixtures/recursive-hub", import.meta.url))
const src = (file: string): string =>
  fileURLToPath(new URL(`./fixtures/recursive-hub/src/${file}`, import.meta.url))

const cleanups = [
  "json.schema.gen.ts",
  "leaf.schema.gen.ts",
  "tree.schema.gen.ts",
  "foreign.schema.gen.ts",
  "json.schema.tskm-query.ts",
  "leaf.schema.tskm-query.ts",
  "tree.schema.tskm-query.ts",
  "foreign.schema.tskm-query.ts",
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

describe.skipIf(!bun)("anti-corruption-layer hub recursive (real tsgo + real worker)", () => {
  it("routes hub-imported recursive() roots to the walker; keeps cross-file fail-closed", async () => {
    const result = await generate({
      root: fixtureRoot,
      config: {
        mode: "sidecar",
        include: ["src/*.schema.ts"],
        tsconfig: "tsconfig.json",
        schemaSources: ["@validator", "@foreign"],
        worker: { execPath: bun },
      },
    })

    // Scenario A — self-recursive union root via the hub: the walker materializes the
    // named self-referential alias, NOT a checker partial with `any` cuts.
    const jsonGen = readFileSync(src("json.schema.gen.ts"), "utf8")
    expect(jsonGen).toContain("export type Json =")
    expect(jsonGen).toContain("Json[]")
    expect(jsonGen).toContain("[key: string]: Json")
    expect(jsonGen).toContain("null")
    expect(jsonGen).not.toContain("any[]")
    expect(jsonGen).not.toContain("Record<string, any>")
    expect(jsonGen).not.toContain(": any")

    // Scenario A — object root via the hub: defining file emits Leaf with the
    // self-referential back-edge.
    const leafGen = readFileSync(src("leaf.schema.gen.ts"), "utf8")
    expect(leafGen).toContain("export type Leaf = {")
    expect(leafGen).toContain("next: Leaf | undefined")
    expect(leafGen).not.toContain("any")

    // Scenario B — declared hub-recursive root referencing an IMPORTED recursive
    // child: skip with a path-precise diagnostic, NO .gen.ts, no dangling/inline.
    expect(existsSync(src("tree.schema.gen.ts"))).toBe(false)
    expect(
      result.diagnostics.some((d) => d.includes("no declared alias") && d.includes("leaf")),
    ).toBe(true)

    // Foreign safety net — a NON-tskm `recursive` helper (vendor !== "tskm") is flagged
    // core-recursive by name, but the worker's vendor gate rejects it: skip with a
    // diagnostic, NO .gen.ts, and never an empty/invalid alias.
    expect(existsSync(src("foreign.schema.gen.ts"))).toBe(false)
    expect(
      result.diagnostics.some(
        (d) => d.includes("foreignSchema") && d.includes("not a recursive() schema"),
      ),
    ).toBe(true)
  }, 180_000)

  it("KEYSTONE: the emitted hub alias type-checks against recursive data", () => {
    writeFileSync(
      src("probe.check.ts"),
      `import type { Json } from "./json.schema.gen.ts"
import type { Leaf } from "./leaf.schema.gen.ts"

const json: Json = { items: [1, "two", true, null], nested: { deep: [null] } } as unknown as Json
const jsonArr: Json = [1, "two", true, null, { a: 1 }]
const leaf: Leaf = { name: "l", next: { name: "n", next: undefined } }

export const probes = [json, jsonArr, leaf] as const
`,
    )
    const check = runTsgoNoEmit(fixtureRoot)
    expect(check.output).not.toContain("error TS")
    expect(check.ok).toBe(true)
  }, 120_000)

  it("leaves no query files behind", () => {
    expect(existsSync(src("json.schema.tskm-query.ts"))).toBe(false)
    expect(existsSync(src("leaf.schema.tskm-query.ts"))).toBe(false)
    expect(existsSync(src("tree.schema.tskm-query.ts"))).toBe(false)
  })
})
