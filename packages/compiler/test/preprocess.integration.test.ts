import { existsSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as compiler from "../src/index.ts"
import { registerSuite } from "./runners/suite.ts"
import { preprocessSuite } from "./scenarios/generate.ts"
import { afterAll, describe, expect, it } from "./test-api.ts"
import { withTestTsgo } from "./tsgo-test-executable.ts"

// The top-level preprocess case is shared with the Node run (scenarios/generate.ts). The
// recursive case below runs the structural worker with this runtime (process.execPath).
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

afterAll(() => {
  for (const file of cleanups) {
    if (existsSync(file)) rmSync(file)
  }
})

describe("preprocess inside recursive (real structural worker)", () => {
  it("emits the inner output type instead of unknown", async () => {
    const result = await compiler.generate({
      root: fixtureRoot,
      config: withTestTsgo({
        mode: "sidecar",
        include: ["src/tree.schema.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: process.execPath },
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
