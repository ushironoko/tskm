import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { TskmConfig } from "../src/config.ts"
import { generate } from "../src/index.ts"

/**
 * Honors the compat-CI override (`TSKM_TEST_TSGO_EXECUTABLE`) the same way as
 * `withTestTsgo` in `tsgo-test-executable.ts`. Kept local so this file does not
 * depend on that module, which lands with the checker-compat CI change.
 */
function withTestTsgo(config: TskmConfig): TskmConfig {
  const executable = process.env.TSKM_TEST_TSGO_EXECUTABLE
  if (executable === undefined || executable.trim() === "" || config.executable !== undefined) {
    return config
  }
  return { ...config, executable }
}

const fixtureRoot = fileURLToPath(new URL("./fixtures/preprocess", import.meta.url))
const src = (file: string): string =>
  fileURLToPath(new URL(`./fixtures/preprocess/src/${file}`, import.meta.url))

const cleanups = [
  src("port.schema.gen.ts"),
  src("port.schema.tskm-query.ts"),
  src("tree.schema.gen.ts"),
  src("tree.schema.tskm-query.ts"),
]

function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

afterAll(() => {
  for (const file of cleanups) {
    if (existsSync(file)) rmSync(file)
  }
})

describe("preprocess codegen (real tsgo)", () => {
  it("emits the inner output type for coerce and preprocess", async () => {
    const result = await generate({
      root: fixtureRoot,
      config: withTestTsgo({
        mode: "sidecar",
        include: ["src/port.schema.ts"],
        tsconfig: "tsconfig.json",
      }),
    })

    expect(result.diagnostics).toEqual([])
    expect(result.files).toHaveLength(1)
    const gen = readFileSync(src("port.schema.gen.ts"), "utf8")
    expect(gen).toContain("export type Port = number")
    expect(gen).toContain("export type Server = {")
    expect(gen).toContain("port: number")
    expect(gen).toContain("verbose: boolean")
  }, 60_000)
})

describe.skipIf(!bun)("preprocess inside recursive (real structural worker)", () => {
  it("emits the inner output type instead of unknown", async () => {
    if (bun === undefined) {
      throw new Error("bun is required")
    }
    const result = await generate({
      root: fixtureRoot,
      config: withTestTsgo({
        mode: "sidecar",
        include: ["src/tree.schema.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: bun },
      }),
    })

    expect(result.files).toHaveLength(1)
    const gen = readFileSync(src("tree.schema.gen.ts"), "utf8")
    expect(gen).toContain("export type Tree = {")
    expect(gen).toContain("score: number")
    expect(gen).not.toContain("score: unknown")
    expect(gen).toContain("child: Tree | undefined")
    expect(result.diagnostics.some((line) => line.includes("unknown schema type"))).toBe(false)
  }, 60_000)
})
