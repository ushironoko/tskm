import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { cpus, totalmem } from "node:os"
import { type BundleRow, measureBundle } from "./bundle.ts"
import {
  type LibraryName,
  libraries,
  measuredIterations,
  measuredRuns,
  memoryParses,
  typeCopies,
  warmupIterations,
} from "./config.ts"
import { type MemoryRow, measureMemory } from "./memory.ts"
import { measureSpeed, type SpeedRow } from "./speed.ts"
import { measureTypes, type TypeRow } from "./types-count.ts"

const require = createRequire(import.meta.url)

function packageVersion(name: string): string {
  return (require(`${name}/package.json`) as { version: string }).version
}

function tskmVersion(): string {
  const file = new URL("../../../packages/tskm/package.json", import.meta.url)
  return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version
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

function cell(value: number): string {
  return value.toLocaleString("en-US")
}

function resultsMarkdown(input: {
  readonly speed: readonly SpeedRow[]
  readonly memory: readonly MemoryRow[]
  readonly bundles: readonly BundleRow[]
  readonly types: readonly TypeRow[]
  readonly versions: Record<LibraryName, string>
  readonly host: ReturnType<typeof machine>
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
    `- Machine: ${input.host.cpu}, ${input.host.cores} cores, ${cell(input.host.memBytes)} bytes RAM`,
    `- Kernel: ${input.host.version}`,
    `- Bun: ${input.host.bun}`,
    `- esbuild: ${packageVersion("esbuild")} (minify, tree-shake, gzip level 9)`,
    `- typescript: ${packageVersionFromRoot("typescript")} (\`tsc\`)`,
    `- @typescript/native-preview: ${packageVersionFromRoot("@typescript/native-preview")} (\`tsgo\`)`,
    `- Copies for type instantiations: ${typeCopies}`,
    `- Speed: warmup ${cell(warmupIterations)}, then ${measuredRuns} runs of ${cell(measuredIterations)}, median`,
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
    "ops/s, median. Valid input is the shared payload. Invalid input fails every constraint group.",
    "",
    "| library | valid ops/s | valid ns/op | invalid ops/s |",
    "| --- | ---: | ---: | ---: |",
    ...libraries.map((name) => {
      const row = speed.get(name)
      if (!row) throw new Error(`missing speed ${name}`)
      return `| ${name} | ${cell(row.validOpsPerSec)} | ${row.validNsPerOp.toFixed(1)} | ${cell(row.invalidOpsPerSec)} |`
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

function packageVersionFromRoot(name: string): string {
  const rootRequire = createRequire(new URL("../../../package.json", import.meta.url))
  return (rootRequire(`${name}/package.json`) as { version: string }).version
}

const only = new Set(process.argv.slice(2))
const selected = libraries.filter((name) => only.size === 0 || only.has(name))

const host = machine()
const libraryVersions = versions()
const speed: SpeedRow[] = []
const memory: MemoryRow[] = []
const bundles: BundleRow[] = []
const types: TypeRow[] = []

if (only.size === 0 || only.has("baseline")) {
  console.log("memory baseline")
  memory.push(measureMemory("baseline"))
}

for (const name of selected) {
  console.log(`speed ${name}`)
  speed.push(await measureSpeed(name))
  console.log(`memory ${name}`)
  memory.push(measureMemory(name))
  console.log(`bundle ${name}`)
  bundles.push(await measureBundle(name))
  console.log(`types ${name}`)
  types.push(...measureTypes(name))
}

if (selected.length === libraries.length) {
  const markdown = resultsMarkdown({
    speed,
    memory,
    bundles,
    types,
    versions: libraryVersions,
    host,
  })
  writeFileSync(new URL("../RESULTS.md", import.meta.url), markdown)
  console.log(markdown)
} else {
  console.log(JSON.stringify({ speed, memory, bundles, types }, null, 2))
}
