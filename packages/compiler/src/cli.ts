#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import type { TskmMode } from "./config.ts"
import { generate } from "./index.ts"
import { generateJsonSchema } from "./jsonschema.ts"
import { watch } from "./watch.ts"

const HELP = `tskm — AOT schema-to-type compiler

Usage:
  tskm <command> [options]

Commands:
  init            Write a starter tskm.config.ts.
  gen             Generate types for all included sources (default: sidecar).
  watch           Generate, then re-generate on file changes.
  json-schema     Emit JSON Schema for each schema (experimental).

Options:
  --root <dir>       Project root (default: cwd).
  --mode <mode>      Emit mode for gen/watch: "sidecar" (default) or "inplace".
  --out <dir>        Output dir for json-schema (default: next to each source).
  --exec <path>      Runtime used to run the json-schema worker (default: this process).
  --debounce <ms>    Debounce window for watch.
  --no-pretty        Emit single-line types instead of pretty-printed.
  -h, --help         Show this help.
`

const STARTER_CONFIG = `import { defineConfig } from "@tskm/compiler"

export default defineConfig({
  // "sidecar" writes <base>.gen.ts; "inplace" rewrites Infer markers in place.
  mode: "sidecar",
  include: ["src/**/*.ts"],
  tsconfig: "tsconfig.json",
})
`

interface ParsedArgs {
  readonly command: string | undefined
  readonly root: string
  readonly mode: TskmMode | undefined
  readonly out: string | undefined
  readonly exec: string | undefined
  readonly debounceMs: number | undefined
  readonly pretty: boolean
  readonly help: boolean
}

function parseMode(value: string | undefined): TskmMode {
  if (value === "sidecar" || value === "inplace") {
    return value
  }
  throw new Error(`tskm: --mode must be "sidecar" or "inplace" (got "${value}").`)
}

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  let command: string | undefined
  let root = process.cwd()
  let mode: TskmMode | undefined
  let out: string | undefined
  let exec: string | undefined
  let debounceMs: number | undefined
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
    } else if (arg === "--mode") {
      mode = parseMode(argv[++i])
    } else if (arg === "--out") {
      const next = argv[++i]
      if (!next) {
        throw new Error("tskm: --out requires a directory argument.")
      }
      out = next
    } else if (arg === "--exec") {
      const next = argv[++i]
      if (!next) {
        throw new Error("tskm: --exec requires a runtime path argument.")
      }
      exec = next
    } else if (arg === "--debounce") {
      const next = argv[++i]
      const parsed = Number(next)
      if (!next || Number.isNaN(parsed)) {
        throw new Error("tskm: --debounce requires a millisecond number.")
      }
      debounceMs = parsed
    } else if (!arg?.startsWith("-") && command === undefined) {
      command = arg
    }
  }

  return { command, root, mode, out, exec, debounceMs, pretty, help }
}

function runInit(root: string): void {
  const target = join(root, "tskm.config.ts")
  if (existsSync(target)) {
    process.stdout.write(`tskm: ${relative(root, target)} already exists; leaving it untouched.\n`)
    return
  }
  writeFileSync(target, STARTER_CONFIG)
  process.stdout.write(`tskm: wrote ${relative(root, target)}\n`)
}

async function runGen(args: ParsedArgs): Promise<void> {
  const result = await generate({ root: args.root, mode: args.mode, pretty: args.pretty })

  for (const file of result.files) {
    const rel = relative(args.root, file.output)
    const tag = file.changed ? "wrote" : "unchanged"
    process.stdout.write(`tskm: ${tag} ${rel} (${file.typeNames.join(", ")})\n`)
  }
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${diagnostic}\n`)
  }
  if (result.files.length === 0) {
    process.stdout.write("tskm: no types generated.\n")
  }
}

async function runWatch(args: ParsedArgs): Promise<void> {
  const controller = await watch({
    root: args.root,
    mode: args.mode,
    pretty: args.pretty,
    debounceMs: args.debounceMs,
    onGenerate: (result) => {
      for (const file of result.files) {
        const rel = relative(args.root, file.output)
        const tag = file.changed ? "wrote" : "unchanged"
        process.stdout.write(`tskm: ${tag} ${rel} (${file.typeNames.join(", ")})\n`)
      }
      for (const diagnostic of result.diagnostics) {
        process.stderr.write(`${diagnostic}\n`)
      }
    },
  })
  process.stdout.write("tskm: watching for changes (Ctrl-C to stop)...\n")

  const stop = (): void => {
    void controller.close().then(() => process.exit(0))
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  // Keep the event loop alive until a signal arrives.
  await new Promise<void>(() => {})
}

async function runJsonSchema(args: ParsedArgs): Promise<void> {
  const result = await generateJsonSchema({
    root: args.root,
    config: args.out ? { jsonSchema: { outDir: args.out } } : undefined,
    execPath: args.exec,
  })
  for (const file of result.files) {
    const rel = relative(args.root, file.output)
    process.stdout.write(`tskm: wrote ${rel} (${file.schemaNames.join(", ")})\n`)
  }
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${diagnostic}\n`)
  }
  if (result.files.length === 0) {
    process.stdout.write("tskm: no JSON Schema generated.\n")
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || args.command === undefined) {
    process.stdout.write(HELP)
    return
  }

  switch (args.command) {
    case "init":
      return runInit(args.root)
    case "gen":
      return runGen(args)
    case "watch":
      return runWatch(args)
    case "json-schema":
      return runJsonSchema(args)
    default:
      process.stderr.write(`tskm: unknown command "${args.command}"\n\n${HELP}`)
      process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exitCode = 1
})
