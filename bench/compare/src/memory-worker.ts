import { readFileSync } from "node:fs"
import { memoryParses } from "./config.ts"
import { validPayload } from "./payload.ts"

function gc() {
  const bun = (globalThis as { Bun?: { gc?: (force?: boolean) => void } }).Bun
  bun?.gc?.(true)
}

function vmHwmBytes(): number {
  const status = readFileSync("/proc/self/status", "utf8")
  const line = status.split("\n").find((entry) => entry.startsWith("VmHWM:"))
  if (!line) throw new Error("VmHWM missing")
  const kb = Number(line.split(/\s+/)[1])
  return kb * 1024
}

const name = process.argv[2] ?? "baseline"
const parse =
  name === "baseline"
    ? () => true
    : ((await import(`./libs/${name}.ts`)).parse as (input: unknown) => boolean)

gc()
const heapAfterLoad = process.memoryUsage().heapUsed
if (name !== "baseline" && !parse(validPayload)) {
  throw new Error(`${name} rejected the valid payload`)
}
gc()
const heapAfterParse = process.memoryUsage().heapUsed

let accepted = 0
let peakHeap = heapAfterParse
for (let i = 0; i < memoryParses; i++) {
  if (parse(name === "baseline" ? undefined : validPayload)) accepted++
  if ((i & 1023) === 0) {
    const heap = process.memoryUsage().heapUsed
    if (heap > peakHeap) peakHeap = heap
  }
}
gc()
const heapAfterWork = process.memoryUsage().heapUsed

console.log(
  JSON.stringify({
    library: name,
    heapAfterLoad,
    heapAfterParse,
    peakHeap,
    heapAfterWork,
    peakRss: vmHwmBytes(),
    accepted,
  }),
)
