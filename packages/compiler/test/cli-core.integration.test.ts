import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
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
      // The fixture's transform is not representable: the file opts into its approximation.
      install([
        "json-schema",
        "--root",
        fixtureRoot,
        "--exec",
        bun as string,
        "--approximate",
        "transform",
      ])
      await main()

      expect(existsSync(jsonOutput)).toBe(true)
      expect(stdout).toContain("tskm: wrote")
      expect(stdout).toContain("account.schema.json")
      expect(stdout).toContain("accountSchema")
      expect(process.exitCode).toBe(0)
    },
    60_000,
  )

  it.skipIf(!bun)(
    "`json-schema` fails closed by default: exit 1, the path and option are printed, no file is written",
    async () => {
      install(["json-schema", "--root", fixtureRoot, "--exec", bun as string])
      await main()

      expect(existsSync(jsonOutput)).toBe(false)
      expect(process.exitCode).toBe(1)
      expect(stderr).toContain("accountSchema.nameLength")
      expect(stderr).toContain('cannot convert pipe item "transform" to JSON Schema output')
      expect(stderr).toContain("--approximate transform")
      expect(stderr).toContain("json-schema failed with 1 error(s)")
      expect(stdout).toContain("tskm: no JSON Schema generated.")
    },
    60_000,
  )

  it("`json-schema` rejects an unknown --approximate name before running anything", async () => {
    install(["json-schema", "--root", fixtureRoot, "--approximate", "bigint,Date"])
    await expect(main()).rejects.toThrow('--approximate has unknown value "Date"')
    expect(existsSync(jsonOutput)).toBe(false)
  })

  it.skipIf(!bun)(
    "`json-schema` refuses non-finite numbers by default (exit 1), and --approximate nonfinite writes them",
    async () => {
      const limitsRoot = fileURLToPath(new URL("./fixtures/json-nonfinite", import.meta.url))
      const limitsOutput = fileURLToPath(
        new URL("./fixtures/json-nonfinite/src/limits.schema.json", import.meta.url),
      )
      try {
        install(["json-schema", "--root", limitsRoot, "--exec", bun as string])
        await main()
        expect(existsSync(limitsOutput)).toBe(false)
        expect(process.exitCode).toBe(1)
        expect(stderr).toContain('limitsSchema.cap: cannot convert schema type "literal"')
        expect(stderr).toContain("Infinity has no JSON representation")
        expect(stderr).toContain("--approximate nonfinite")
        expect(stderr).toContain("json-schema failed with 3 error(s)")

        install([
          "json-schema",
          "--root",
          limitsRoot,
          "--exec",
          bun as string,
          "--approximate",
          "nonfinite",
        ])
        await main()
        expect(existsSync(limitsOutput)).toBe(true)
        expect(process.exitCode).toBe(0)
        expect(stdout).toContain("tskm: wrote")
        expect(stdout).toContain("limits.schema.json")
        expect(stderr).toContain("approximated nonfinite as a schema no JSON value matches.")
      } finally {
        rmSync(limitsOutput, { force: true })
      }
    },
    60_000,
  )

  it.skipIf(!bun)(
    "`json-schema` deletes a stale output when its source now fails, and says so on stdout",
    async () => {
      const staleRoot = fileURLToPath(new URL("./fixtures/json-stale", import.meta.url))
      const srcDir = join(staleRoot, "src")
      const source = join(srcDir, "order.schema.ts")
      const output = join(srcDir, "order.schema.json")
      try {
        mkdirSync(srcDir, { recursive: true })
        writeFileSync(
          source,
          `import { object, string } from "@tskm/core"\nexport const orderSchema = object({ id: string() })\n`,
        )
        install(["json-schema", "--root", staleRoot, "--exec", bun as string])
        await main()
        expect(process.exitCode).toBe(0)
        expect(existsSync(output)).toBe(true)

        writeFileSync(
          source,
          `import { bigint, object } from "@tskm/core"\nexport const orderSchema = object({ amount: bigint() })\n`,
        )
        install(["json-schema", "--root", staleRoot, "--exec", bun as string])
        await main()
        expect(process.exitCode).toBe(1)
        expect(existsSync(output)).toBe(false)
        expect(stdout).toContain(
          "tskm: removed src/order.schema.json: its source produced no document, so the previous output was deleted.",
        )
        expect(stderr).toContain(
          "json-schema failed with 1 error(s); the affected files were not written.",
        )
      } finally {
        rmSync(srcDir, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
