import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { main, parseArgs, runInit } from "../src/cli-core.ts"

describe("parseArgs", () => {
  it("returns defaults when given no args", () => {
    const args = parseArgs([])
    expect(args.command).toBeUndefined()
    expect(args.root).toBe(process.cwd())
    expect(args.mode).toBeUndefined()
    expect(args.out).toBeUndefined()
    expect(args.exec).toBeUndefined()
    expect(args.debounceMs).toBeUndefined()
    expect(args.pretty).toBe(true)
    expect(args.help).toBe(false)
  })

  it("captures a bare command token", () => {
    expect(parseArgs(["gen"]).command).toBe("gen")
  })

  it("sets help via -h and via --help", () => {
    expect(parseArgs(["-h"]).help).toBe(true)
    expect(parseArgs(["--help"]).help).toBe(true)
  })

  it("--no-pretty disables pretty", () => {
    expect(parseArgs(["--no-pretty"]).pretty).toBe(false)
  })

  it("--root resolves to an absolute path", () => {
    const args = parseArgs(["--root", "some/dir"])
    expect(isAbsolute(args.root)).toBe(true)
    expect(args.root).toBe(join(process.cwd(), "some/dir"))
  })

  it("--root without a value throws", () => {
    expect(() => parseArgs(["--root"])).toThrow("requires a directory")
  })

  it("--mode sidecar and inplace are accepted", () => {
    expect(parseArgs(["--mode", "sidecar"]).mode).toBe("sidecar")
    expect(parseArgs(["--mode", "inplace"]).mode).toBe("inplace")
  })

  it("--mode with an invalid value throws", () => {
    expect(() => parseArgs(["--mode", "bogus"])).toThrow(
      'tskm: --mode must be "sidecar" or "inplace" (got "bogus").',
    )
  })

  it("--mode with a missing value throws", () => {
    expect(() => parseArgs(["--mode"])).toThrow(
      'tskm: --mode must be "sidecar" or "inplace" (got "undefined").',
    )
  })

  it("--out captures the directory and throws when missing", () => {
    expect(parseArgs(["--out", "schemas"]).out).toBe("schemas")
    expect(() => parseArgs(["--out"])).toThrow("--out requires a directory")
  })

  it("--exec captures the path and throws when missing", () => {
    expect(parseArgs(["--exec", "/bin/node"]).exec).toBe("/bin/node")
    expect(() => parseArgs(["--exec"])).toThrow("--exec requires a runtime path")
  })

  it("--debounce parses a number, throws on NaN, throws when missing", () => {
    expect(parseArgs(["--debounce", "250"]).debounceMs).toBe(250)
    expect(() => parseArgs(["--debounce", "notanumber"])).toThrow(
      "--debounce requires a millisecond number",
    )
    expect(() => parseArgs(["--debounce"])).toThrow("--debounce requires a millisecond number")
  })

  it("a leading-dash unknown flag does not become the command", () => {
    expect(parseArgs(["--unknown"]).command).toBeUndefined()
    expect(parseArgs(["--unknown", "gen"]).command).toBe("gen")
  })

  it("keeps the first command and ignores later bare tokens", () => {
    expect(parseArgs(["gen", "watch"]).command).toBe("gen")
  })
})

describe("runInit", () => {
  it("writes tskm.config.ts on first call and is idempotent on the second", () => {
    const dir = mkdtempSync(join(tmpdir(), "tskm-init-"))
    const target = join(dir, "tskm.config.ts")

    runInit(dir)
    expect(existsSync(target)).toBe(true)
    const written = readFileSync(target, "utf8")
    expect(written).toContain('import { defineConfig } from "@tskm/compiler"')
    expect(written).toContain('mode: "sidecar"')
    expect(written).toContain('include: ["src/**/*.ts"]')

    // Second call must not overwrite — assert content is byte-identical afterwards.
    runInit(dir)
    expect(readFileSync(target, "utf8")).toBe(written)
  })
})

type Writer = (chunk: Uint8Array | string) => boolean

describe("main", () => {
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
    // Bun (1.3.13) does NOT clear a previously-set exitCode via `= undefined`; only a
    // numeric assignment resets it, so start each case from a known 0.
    process.exitCode = 0
    process.stdout.write = ((chunk: Uint8Array | string) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
      return true
    }) as any
    process.stderr.write = ((chunk: Uint8Array | string) => {
      stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
      return true
    }) as any
  }

  afterEach(() => {
    process.argv = savedArgv
    // The "bogus" case sets exitCode=1; Bun won't clear it via `= undefined`, so a
    // numeric reset is required to avoid the whole `bun test` run exiting nonzero.
    process.exitCode = savedExitCode ?? 0
    process.stdout.write = savedStdoutWrite as Writer
    process.stderr.write = savedStderrWrite as Writer
  })

  it("--help writes HELP and does not set exitCode", async () => {
    install(["--help"])
    await main()
    expect(stdout).toContain("AOT schema-to-type compiler")
    expect(stdout).toContain("Usage:")
    // main() never sets exitCode on this path; install() reset it to 0.
    expect(process.exitCode).toBe(0)
  })

  it("no command writes HELP and does not set exitCode", async () => {
    install([])
    await main()
    expect(stdout).toContain("AOT schema-to-type compiler")
    expect(process.exitCode).toBe(0)
  })

  it("an unknown command sets exitCode 1 and reports it", async () => {
    install(["bogus"])
    await main()
    expect(stderr).toContain('tskm: unknown command "bogus"')
    expect(process.exitCode).toBe(1)
  })

  it("init --root <tmp> creates the config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tskm-main-init-"))
    install(["init", "--root", dir])
    await main()
    expect(existsSync(join(dir, "tskm.config.ts"))).toBe(true)
    expect(stdout).toContain("wrote tskm.config.ts")
    expect(process.exitCode).toBe(0)
  })
})
