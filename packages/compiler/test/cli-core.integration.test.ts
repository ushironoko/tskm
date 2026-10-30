import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { main } from "../src/cli-core.ts"
import { testTsgoExecutable } from "./tsgo-test-executable.ts"

// Drives the real `gen` / `json-schema` command paths in cli-core's `main()` end to end
// (real tsgo for gen, the real isolated worker subprocess for json-schema), exercising
// `runGen` / `runJsonSchema` and the command-routing arms that the unit tests can't reach.
const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url))
const sidecar = fileURLToPath(
  new URL("./fixtures/basic/src/account.schema.gen.ts", import.meta.url),
)
const queryGlob = fileURLToPath(
  new URL("./fixtures/basic/src/account.schema.tskm-query.ts", import.meta.url),
)
const jsonOutput = fileURLToPath(
  new URL("./fixtures/basic/src/account.schema.json", import.meta.url),
)
// main() -> generate() loads tskm.config.* from the fixture. The CLI has no
// executable flag, so the override is passed through the existing config field.
const tsgoConfig = fileURLToPath(new URL("./fixtures/basic/tskm.config.mjs", import.meta.url))
let wroteTsgoOverride = false

function writeTsgoOverride(): void {
  const executable = testTsgoExecutable()
  if (!executable) return
  writeFileSync(tsgoConfig, `export default { executable: ${JSON.stringify(executable)} }\n`)
  wroteTsgoOverride = true
}

function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

type Writer = (chunk: Uint8Array | string) => boolean

describe("cli-core main() — real command execution", () => {
  const savedArgv = process.argv
  const savedExitCode = process.exitCode
  const savedStdoutWrite = process.stdout.write.bind(process.stdout)
  const savedStderrWrite = process.stderr.write.bind(process.stderr)

  let stdout = ""
  let stderr = ""

  const install = (argv: ReadonlyArray<string>): void => {
    stdout = ""
    stderr = ""
    process.argv = ["bun", "cli", ...argv]
    process.exitCode = 0
    process.stdout.write = ((chunk: Uint8Array | string) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
      return true
    }) as Writer
    process.stderr.write = ((chunk: Uint8Array | string) => {
      stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
      return true
    }) as Writer
  }

  afterEach(() => {
    process.argv = savedArgv
    process.exitCode = savedExitCode ?? 0
    process.stdout.write = savedStdoutWrite as Writer
    process.stderr.write = savedStderrWrite as Writer
    for (const f of [sidecar, queryGlob, jsonOutput]) {
      if (existsSync(f)) rmSync(f)
    }
    if (wroteTsgoOverride && existsSync(tsgoConfig)) rmSync(tsgoConfig)
    wroteTsgoOverride = false
  })

  it("`gen` materializes a sidecar and reports the written file with its type names", async () => {
    writeTsgoOverride()
    install(["gen", "--root", fixtureRoot])
    await main()

    // The sidecar landed and `runGen` announced it on stdout with the expanded type names.
    expect(existsSync(sidecar)).toBe(true)
    expect(stdout).toContain("tskm: wrote")
    expect(stdout).toContain("account.schema.gen.ts")
    expect(stdout).toContain("Account")
    expect(stdout).toContain("Tag")
    // A clean fixture resolves without diagnostics, so nothing is written to stderr.
    expect(stderr).toBe("")
    // The transient query glob is cleaned up by the pipeline, not left behind.
    expect(existsSync(queryGlob)).toBe(false)
    expect(process.exitCode).toBe(0)
  }, 60_000)

  it.skipIf(!bun)(
    "`json-schema` emits a schema file and reports the written file with its schema names",
    async () => {
      install(["json-schema", "--root", fixtureRoot, "--exec", bun as string])
      await main()

      expect(existsSync(jsonOutput)).toBe(true)
      expect(stdout).toContain("tskm: wrote")
      expect(stdout).toContain("account.schema.json")
      expect(stdout).toContain("accountSchema")
      expect(process.exitCode).toBe(0)
    },
    60_000,
  )
})
