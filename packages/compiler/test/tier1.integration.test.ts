import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"
import { createTsgoClient } from "../src/tsgo-client.ts"
import { verifyFixpoint } from "../src/verify-splice.ts"
import { runTsgoNoEmit } from "./typecheck-harness.ts"

// Tier-1 end-to-end: transform-bearing recursive roots run sentinel unroll ->
// substitution guards -> data-key cross-check -> fixpoint oracle, and only verified
// candidates reach the sidecar. Everything else keeps the Tier-2 skeleton.
const fixtureRoot = fileURLToPath(new URL("./fixtures/tier1", import.meta.url))
const src = (file: string): string =>
  fileURLToPath(new URL(`./fixtures/tier1/src/${file}`, import.meta.url))

const cleanups = [
  "s2.schema.gen.ts",
  "s3.schema.gen.ts",
  "s4.schema.gen.ts",
  "s5.schema.gen.ts",
  "s6.schema.gen.ts",
  "mono.schema.gen.ts",
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

describe.skipIf(!bun)("Tier-1 sentinel splice (real tsgo + real worker)", () => {
  it("splices checker-resolved transform outputs into recursive aliases (S2-S5)", async () => {
    const result = await generate({
      root: fixtureRoot,
      config: {
        mode: "sidecar",
        include: ["src/*.schema.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: bun },
      },
    })
    expect(result.files.length).toBe(6)

    // S2: object-in-cycle — the transform output (number) is REAL, not unknown.
    const s2 = readFileSync(src("s2.schema.gen.ts"), "utf8")
    expect(s2).toContain("age: number")
    expect(s2).toContain("children: S2[]")
    expect(s2).not.toContain("age: unknown")

    // S3: union-in-cycle composed by tsgo.
    const s3 = readFileSync(src("s3.schema.gen.ts"), "utf8")
    expect(s3).toContain("string")
    expect(s3).toContain("next: S3")
    expect(s3).not.toContain("unknown")

    // S4: a REAL tuple with the transform output at position [1].
    const s4 = readFileSync(src("s4.schema.gen.ts"), "utf8")
    expect(s4).toContain("string,")
    expect(s4).toContain("boolean,")
    expect(s4).toContain("S4")
    expect(s4).not.toContain("unknown")

    // S5: optional self boundary survives; the transform leaf is number.
    const s5 = readFileSync(src("s5.schema.gen.ts"), "utf8")
    expect(s5).toContain("len: number")
    expect(s5).toContain("S5 | undefined")
    expect(s5).not.toContain("len: unknown")

    // S6: brand absorption — the cross-check rejects the candidate; the structural
    // skeleton stands (correct brand intersection, transform degraded honestly).
    const s6 = readFileSync(src("s6.schema.gen.ts"), "utf8")
    expect(s6).toContain('"~brand": "Node"')
    expect(s6).toContain("score: unknown")
    expect(s6).toContain("id: string")
    expect(result.diagnostics.some((d) => d.includes("S6") && d.includes("skeleton"))).toBe(true)

    // Monomorphic build: the unroll cannot instantiate; Tier-2 floor, never `{}`.
    const mono = readFileSync(src("mono.schema.gen.ts"), "utf8")
    expect(mono).toContain("tag: unknown")
    expect(mono).toContain("next: Mono | undefined")
    expect(mono).not.toContain("next?:")
    expect(result.diagnostics.some((d) => d.includes("Mono") || d.includes("monoSchema"))).toBe(
      true,
    )
  }, 180_000)

  it("KEYSTONE: the Tier-1 sidecars type-check under real tsgo with a value probe", () => {
    writeFileSync(
      src("probe.check.ts"),
      `import type { S2 } from "./s2.schema.gen.ts"
import type { S3 } from "./s3.schema.gen.ts"

const s2: S2 = { name: "n", age: 1, children: [{ name: "c", age: 2, children: [] }] }
const s3a: S3 = "stringified"
const s3b: S3 = { next: { next: "x" } }

export const probes = [s2, s3a, s3b] as const
`,
    )
    const check = runTsgoNoEmit(fixtureRoot)
    expect(check.output).not.toContain("error TS")
    expect(check.ok).toBe(true)
  }, 120_000)

  it("ORACLE discrimination: accepts the correct candidate, rejects wrong/missing", () => {
    const client = createTsgoClient({
      cwd: fixtureRoot,
      tsconfigPath: `${fixtureRoot}/tsconfig.json`,
    })
    try {
      const source = src("s2.schema.ts")
      const correct = verifyFixpoint(
        client,
        source,
        "s2Schema",
        "S2",
        "{ name: string; age: number; children: S2[] }",
        0,
      )
      expect(correct.sound).toBe(true)

      // Wrong transform output: age typed string — bidirectional assignability fails.
      const wrong = verifyFixpoint(
        client,
        source,
        "s2Schema",
        "S2",
        "{ name: string; age: string; children: S2[] }",
        1,
      )
      expect(wrong.sound).toBe(false)
      expect(wrong.reason).toContain("TS2322")

      // Missing field: rejected with the missing-property code.
      const missing = verifyFixpoint(
        client,
        source,
        "s2Schema",
        "S2",
        "{ name: string; children: S2[] }",
        2,
      )
      expect(missing.sound).toBe(false)
      expect(missing.reason).toContain("TS2741")
    } finally {
      client.close()
    }
  }, 120_000)
})
