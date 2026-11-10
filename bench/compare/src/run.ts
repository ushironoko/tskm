import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { cpus, totalmem } from "node:os"
import { fileURLToPath } from "node:url"
import { type AgreementReport, checkAgreement } from "./agreement.ts"
import { type BundleRow, measureBundle } from "./bundle.ts"
import {
  type LibraryName,
  libraries,
  measuredIterations,
  measuredRounds,
  memoryParses,
  typeCopies,
  warmupIterations,
} from "./config.ts"
import { type MemoryRow, measureMemory } from "./memory.ts"
import { measureSpeed, type Range, type SpeedRow } from "./speed.ts"
import { measureTypes, type TypeRow } from "./types-count.ts"

const require = createRequire(import.meta.url)

function packageVersion(name: string): string {
  return (require(`${name}/package.json`) as { version: string }).version
}

function tskmVersion(): string {
  const file = new URL("../../../packages/tskm/package.json", import.meta.url)
  return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version
}

/** tskm is measured from its built `dist`, the files npm installs (Bun transpiles `src` on
 * load, which adds memory and time that a user of the package never pays). Rebuild first so
 * `dist` cannot be stale. */
function buildTskm(): void {
  const cwd = fileURLToPath(new URL("../../../packages/tskm/", import.meta.url))
  const child = spawnSync(process.execPath, ["run", "build"], { cwd, encoding: "utf8" })
  if (child.error || child.status !== 0) {
    throw new Error(`building @tskm/core failed\n${child.stdout}\n${child.stderr}${child.error}`)
  }
}

function versions(): Record<LibraryName, string> {
  return {
    tskm: tskmVersion(),
    zod: packageVersion("zod"),
    valibot: packageVersion("valibot"),
    arktype: packageVersion("arktype"),
    typebox: packageVersion("typebox"),
    effect: packageVersion("effect"),
  }
}

function machine() {
  const version = readFileSync("/proc/version", "utf8").trim()
  return {
    version,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    memBytes: totalmem(),
    bun: (process.versions as { bun?: string }).bun ?? "unknown",
  }
}

/** 1, 5 and 15 minute load averages. Other processes share this machine, so record them. */
function loadAverage(): string {
  return readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).join(" ")
}

function cell(value: number): string {
  return value.toLocaleString("en-US")
}

function spread(range: Range): string {
  return `${cell(Math.round(range.min))} – ${cell(Math.round(range.max))}`
}

function resultsMarkdown(input: {
  readonly agreement: AgreementReport
  readonly speed: readonly SpeedRow[]
  readonly memory: readonly MemoryRow[]
  readonly bundles: readonly BundleRow[]
  readonly types: readonly TypeRow[]
  readonly versions: Record<LibraryName, string>
  readonly host: ReturnType<typeof machine>
  readonly load: { readonly start: string; readonly end: string }
}): string {
  const speed = new Map(input.speed.map((row) => [row.library, row]))
  const memory = new Map(input.memory.map((row) => [row.library, row]))
  const bundles = new Map(input.bundles.map((row) => [row.library, row]))
  const lines = [
    "# Compare",
    "",
    "Measured by `bun src/run.ts` in `bench/compare`. Procedure and library calls are in `README.md`.",
    "",
    "## Run",
    "",
    `- When: ${new Date().toISOString()}`,
    `- Agreement: ${cell(input.agreement.checked)} inputs (${input.agreement.generatedAccepted} generated emails valid), ${input.agreement.mismatches.length} mismatches across ${input.agreement.libraries.length} libraries (\`src/agreement.ts\`, checked before timing)`,
    `- Machine: ${input.host.cpu}, ${input.host.cores} cores, ${cell(input.host.memBytes)} bytes RAM`,
    `- Kernel: ${input.host.version}`,
    `- Bun: ${input.host.bun}`,
    `- esbuild: ${packageVersion("esbuild")} (minify, tree-shake, gzip level 9)`,
    `- typescript: ${packageVersion("typescript")} (\`tsc\`)`,
    `- @typescript/native-preview: ${packageVersion("@typescript/native-preview")} (\`tsgo\`)`,
    `- Copies for type instantiations: ${typeCopies}`,
    `- Speed: each library in a fresh process; warmup ${cell(warmupIterations)} per payload, then ${measuredRounds} interleaved rounds of ${cell(measuredIterations)} valid and ${cell(measuredIterations)} invalid parses. Table: median, with min – max over rounds.`,
    `- Load average (1, 5, 15 min): before speed ${input.load.start}; after speed ${input.load.end}`,
    `- Memory parses: ${cell(memoryParses)}`,
    "",
    "## Versions",
    "",
    ...libraries.map((name) => `- ${name}: ${input.versions[name]}`),
    "",
    "## Memory",
    "",
    "Bytes. `baseline` imports no library and parses nothing. `heap after load` is `heapUsed` after a forced GC. `peak RSS` is `VmHWM`.",
    "",
    "| library | heap after load | heap after one parse | peak heap during parses | heap after parses + GC | peak RSS |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...(["baseline", ...libraries] as const).map((name) => {
      const row = memory.get(name)
      if (!row) throw new Error(`missing memory ${name}`)
      return `| ${name} | ${cell(row.heapAfterLoad)} | ${cell(row.heapAfterParse)} | ${cell(row.peakHeap)} | ${cell(row.heapAfterWork)} | ${cell(row.peakRss)} |`
    }),
    "",
    "## Speed",
    "",
    "ops/s. Valid input is the shared payload. Invalid input fails every constraint group. Each cell is the median over the rounds, with the min – max range below it in the next column.",
    "",
    "| library | valid ops/s | valid min – max | valid ns/op | invalid ops/s | invalid min – max |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...libraries.map((name) => {
      const row = speed.get(name)
      if (!row) throw new Error(`missing speed ${name}`)
      return `| ${name} | ${cell(Math.round(row.validOpsPerSec.median))} | ${spread(row.validOpsPerSec)} | ${row.validNsPerOp.toFixed(1)} | ${cell(Math.round(row.invalidOpsPerSec.median))} | ${spread(row.invalidOpsPerSec)} |`
    }),
    "",
    "## Bundle gzip",
    "",
    "| library | raw bytes | gzip bytes |",
    "| --- | ---: | ---: |",
    ...libraries.map((name) => {
      const row = bundles.get(name)
      if (!row) throw new Error(`missing bundle ${name}`)
      return `| ${name} | ${cell(row.bytes)} | ${cell(row.gzipBytes)} |`
    }),
    "",
    "## Type instantiations",
    "",
    `${typeCopies} copies of the schema in one project. \`skipLibCheck\` is on. Check time is milliseconds from \`--extendedDiagnostics\`.`,
    "",
    "| library | tsc instantiations | tsc check ms | tsgo instantiations | tsgo check ms |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...libraries.map((name) => {
      const tsc = input.types.find((row) => row.library === name && row.checker === "tsc")
      const tsgo = input.types.find((row) => row.library === name && row.checker === "tsgo")
      if (!tsc || !tsgo) throw new Error(`missing types ${name}`)
      return `| ${name} | ${cell(tsc.instantiations)} | ${cell(tsc.checkTimeMs)} | ${cell(tsgo.instantiations)} | ${cell(tsgo.checkTimeMs)} |`
    }),
    "",
  ]
  return lines.join("\n")
}

const only = new Set(process.argv.slice(2))
const selected = libraries.filter((name) => only.size === 0 || only.has(name))

buildTskm()
const host = machine()
const libraryVersions = versions()
// Timing a library that disagrees with the spec would measure a different job, so the
// agreement check runs first and stops the run on any mismatch.
const agreement = await checkAgreement()
const memory: MemoryRow[] = []
const bundles: BundleRow[] = []
const types: TypeRow[] = []

const loadStart = loadAverage()
console.log("speed (interleaved rounds)")
const speed: SpeedRow[] = measureSpeed(selected)
const loadEnd = loadAverage()

if (only.size === 0 || only.has("baseline")) {
  console.log("memory baseline")
  memory.push(measureMemory("baseline"))
}

for (const name of selected) {
  console.log(`memory ${name}`)
  memory.push(measureMemory(name))
  console.log(`bundle ${name}`)
  bundles.push(await measureBundle(name))
  console.log(`types ${name}`)
  types.push(...measureTypes(name))
}

if (selected.length === libraries.length) {
  const markdown = resultsMarkdown({
    agreement,
    speed,
    memory,
    bundles,
    types,
    versions: libraryVersions,
    host,
    load: { start: loadStart, end: loadEnd },
  })
  writeFileSync(new URL("../RESULTS.md", import.meta.url), markdown)
  console.log(markdown)
} else {
  console.log(JSON.stringify({ speed, memory, bundles, types }, null, 2))
}
