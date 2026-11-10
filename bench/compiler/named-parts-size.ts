/**
 * Size and checker-cost benchmark for named object parts (issue #59).
 *
 * Builds a deterministic 400-schema sample (one source file, `src/schemas.schema.ts`, the shape
 * the issue describes), generates its sidecar with the compiler under test, and reports:
 *
 *   - the sidecar's byte size (`*.gen.ts`), the number of aliases, and generate() wall time;
 *   - tsc's `Instantiations` and `Types` for a project made of the source plus its sidecar,
 *     the AOT build in which the generated types are consumed. tsc is the native checker that
 *     ships with the `typescript` peer, run with `--extendedDiagnostics`.
 *
 * The sample is generated, not committed, so the numbers are reproducible from this file alone.
 * It is NOT the issue author's 918,730 B sample, which is not available. Compare two trees by
 * running this script against each:
 *
 *   bun bench/compiler/named-parts-size.ts                      # the working tree
 *   bun bench/compiler/named-parts-size.ts --compiler <dir>/packages/compiler/src/index.ts
 *
 * `--keep <dir>` keeps the sample and its sidecar for inspection. `--json` prints machine output.
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repo = fileURLToPath(new URL("../..", import.meta.url))
const tskmIndex = join(repo, "packages/tskm/src/index.ts")
const defaultCompiler = join(repo, "packages/compiler/src/index.ts")

/** Shared building blocks: exported, and reused by the composites below. */
const PART_COUNT = 40
/** Total exported schemas in the sample. */
const SCHEMA_COUNT = 400

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// Deterministic PRNG (mulberry32). The sample is a pure function of this seed.
function prng(seedValue: number): () => number {
  let seed = seedValue
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = [
  "user",
  "order",
  "invoice",
  "shipment",
  "product",
  "account",
  "payment",
  "ticket",
  "event",
  "report",
  "team",
  "project",
  "device",
  "session",
  "policy",
]
const LEAVES = [
  "string()",
  "number()",
  "boolean()",
  "pipe(string(), minLength(1))",
  "optional(string())",
  "nullable(number())",
  'picklist(["open", "closed", "pending"])',
  'literal("v1")',
  "array(string())",
  "optional(number())",
  "pipe(number(), integer())",
  "pipe(string(), email())",
]

/** The source file for the sample: shared parts first, then composites that reuse them. */
export function sampleSource(count: number): string {
  const rand = prng(59)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T
  const parts: Array<{ name: string }> = []
  const lines: string[] = []

  for (let i = 0; i < PART_COUNT; i++) {
    const fieldCount = 3 + Math.floor(rand() * 4)
    const fields: string[] = []
    for (let f = 0; f < fieldCount; f++) fields.push(`f${f}: ${pick(LEAVES)}`)
    if (parts.length > 0 && rand() < 0.5) fields.push(`ref: ${pick(parts).name}`)
    const name = `part${i}Schema`
    parts.push({ name })
    lines.push(`export const ${name} = object({ ${fields.join(", ")} })`)
  }

  for (let i = 0; i < count - PART_COUNT; i++) {
    const word = WORDS[i % WORDS.length] as string
    const fieldCount = 2 + Math.floor(rand() * 4)
    const fields: string[] = []
    for (let f = 0; f < fieldCount; f++) fields.push(`x${f}: ${pick(LEAVES)}`)
    const refs = 1 + Math.floor(rand() * 3)
    for (let r = 0; r < refs; r++) {
      const sub = pick(parts).name
      const form = rand()
      const expr = form < 0.5 ? sub : form < 0.75 ? `optional(${sub})` : `array(${sub})`
      fields.push(`p${r}: ${expr}`)
    }
    if (rand() < 0.3) fields.push(`choice: union([${pick(parts).name}, ${pick(parts).name}])`)
    lines.push(`export const ${word}${i}Schema = object({ ${fields.join(", ")} })`)
  }

  const imports =
    'import { array, boolean, email, integer, literal, minLength, nullable, number, object, optional, picklist, pipe, string, union } from "@tskm/core"'
  return `${[imports, "", ...lines, ""].join("\n")}`
}

function writeProject(root: string, source: string): void {
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "src/schemas.schema.ts"), source)
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          allowImportingTsExtensions: true,
          paths: { "@tskm/core": [tskmIndex] },
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
  )
  // The measured project: the source and its sidecar, with no query files in it.
  writeFileSync(
    join(root, "tsconfig.measure.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          allowImportingTsExtensions: true,
          paths: { "@tskm/core": [tskmIndex] },
        },
        include: ["src/schemas.schema.ts", "src/schemas.schema.gen.ts"],
      },
      null,
      2,
    )}\n`,
  )
}

interface Measurement {
  readonly compiler: string
  readonly schemas: number
  readonly sidecarBytes: number
  readonly aliases: number
  readonly generateMs: number
  readonly instantiations: number
  readonly types: number
  readonly tscMs: number
}

async function measure(compilerIndex: string, keep: string | undefined): Promise<Measurement> {
  const root = keep ?? mkdtempSync(join(tmpdir(), "tskm-named-parts-"))
  const source = sampleSource(SCHEMA_COUNT)
  writeProject(root, source)

  // The compiler under test is imported from the path given, so the same script measures any tree.
  const { generate } = (await import(pathToFileURL(compilerIndex).href)) as {
    generate: (
      options: unknown,
    ) => Promise<{ files: Array<{ output: string; typeNames: string[] }>; diagnostics: string[] }>
  }
  const generateOnce = () =>
    generate({
      root,
      config: { mode: "sidecar", include: ["src/*.schema.ts"], tsconfig: "tsconfig.json" },
    })
  // One untimed run warms the checker's files; the median of three timed runs is reported.
  await generateOnce()
  const times: number[] = []
  let result: Awaited<ReturnType<typeof generateOnce>> | undefined
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    result = await generateOnce()
    times.push(performance.now() - start)
  }
  const file = result?.files[0]
  if (!file) {
    throw new Error(
      `named-parts-size: generate produced no sidecar: ${result?.diagnostics.join("\n")}`,
    )
  }
  const sidecarBytes = statSync(file.output).size
  const aliases = file.typeNames.length
  const generateMs = [...times].sort((a, b) => a - b)[1] ?? 0

  // tsc, from the typescript package this repo resolves (the compiler's own peer dependency).
  const require = createRequire(join(repo, "packages/compiler/package.json"))
  const tscBin = join(require.resolve("typescript/package.json"), "..", "bin", "tsc")
  const tscStart = performance.now()
  const tsc = spawnSync(
    tscBin,
    ["-p", join(root, "tsconfig.measure.json"), "--noEmit", "--extendedDiagnostics"],
    {
      encoding: "utf8",
    },
  )
  const tscMs = performance.now() - tscStart
  const output = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`
  const counter = (label: string): number => {
    const match = new RegExp(`^${label}:\\s+(\\d+)$`, "m").exec(output)
    if (!match) {
      throw new Error(`named-parts-size: tsc printed no "${label}" line:\n${output}`)
    }
    return Number(match[1])
  }
  const measurement: Measurement = {
    compiler: compilerIndex,
    schemas: SCHEMA_COUNT,
    sidecarBytes,
    aliases,
    generateMs,
    instantiations: counter("Instantiations"),
    types: counter("Types"),
    tscMs,
  }
  if (!keep) {
    rmSync(root, { recursive: true, force: true })
  }
  return measurement
}

async function main(): Promise<void> {
  const compiler = arg("--compiler") ?? defaultCompiler
  const keep = arg("--keep")
  const jsonOut = process.argv.includes("--json")
  const result = await measure(compiler, keep)
  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(`# named object parts: ${result.schemas}-schema sample`)
  console.log("")
  console.log(`compiler:        ${result.compiler}`)
  console.log(`sidecar bytes:   ${result.sidecarBytes.toLocaleString("en-US")} B`)
  console.log(`aliases:         ${result.aliases}`)
  console.log(`generate (ms):   ${result.generateMs.toFixed(0)} (median of 3, warm)`)
  console.log(`tsc Instantiations: ${result.instantiations.toLocaleString("en-US")}`)
  console.log(`tsc Types:          ${result.types.toLocaleString("en-US")}`)
  if (keep) {
    console.log(`kept in:         ${keep}`)
  }
}

if (import.meta.main) {
  await main()
}
