import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as compiler from "../src/index.ts"
import { registerSuite } from "./runners/bun.ts"
import { preprocessSuite } from "./scenarios/generate.ts"
import { withTestTsgo } from "./tsgo-test-executable.ts"

// The top-level preprocess case is shared with the Node run (scenarios/generate.ts). The
// recursive case below runs the structural worker under Bun, so it stays Bun-only.
registerSuite(preprocessSuite(compiler))

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

describe.skipIf(!bun)("preprocess inside recursive (real structural worker)", () => {
  it("emits the inner output type instead of unknown", async () => {
    if (bun === undefined) {
      throw new Error("bun is required")
    }
    const result = await compiler.generate({
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
