#!/usr/bin/env node
import { relative, resolve } from "node:path"
import { generate } from "./index.ts"

const HELP = `tskm — AOT schema-to-type compiler

Usage:
  tskm gen [--root <dir>] [--no-pretty]

Commands:
  gen        Generate sidecar .gen.ts files for all included sources.

Options:
  --root <dir>   Project root (default: cwd).
  --no-pretty    Emit single-line types instead of pretty-printed.
  -h, --help     Show this help.
`

interface ParsedArgs {
  readonly command: string | undefined
  readonly root: string
  readonly pretty: boolean
  readonly help: boolean
}

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  let command: string | undefined
  let root = process.cwd()
  let pretty = true
  let help = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "-h" || arg === "--help") {
      help = true
    } else if (arg === "--no-pretty") {
      pretty = false
    } else if (arg === "--root") {
      const next = argv[++i]
      if (!next) {
        throw new Error("tskm: --root requires a directory argument.")
      }
      root = resolve(next)
    } else if (!arg?.startsWith("-") && command === undefined) {
      command = arg
    }
  }

  return { command, root, pretty, help }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || args.command === undefined) {
    process.stdout.write(HELP)
    return
  }

  if (args.command !== "gen") {
    process.stderr.write(`tskm: unknown command "${args.command}"\n\n${HELP}`)
    process.exitCode = 1
    return
  }

  const result = await generate({ root: args.root, pretty: args.pretty })

  for (const file of result.files) {
    const rel = relative(args.root, file.sidecar)
    process.stdout.write(`tskm: wrote ${rel} (${file.typeNames.join(", ")})\n`)
  }
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${diagnostic}\n`)
  }

  if (result.files.length === 0) {
    process.stdout.write("tskm: no types generated.\n")
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exitCode = 1
})
