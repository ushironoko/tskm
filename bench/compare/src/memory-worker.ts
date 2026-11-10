import { heapStats } from "bun:jsc"
import { readFileSync } from "node:fs"
import { memoryParses } from "./config.ts"
import { validPayload } from "./payload.ts"

/**
 * One library in one fresh Bun process. Reads the JSC heap counters from `bun:jsc`, not
 * `process.memoryUsage().heapUsed`: under Bun 1.3.13, `heapUsed` after a forced GC reads
 * 212,874 bytes for tskm and zod, the same as an empty process, while `heapStats().heapSize`
 * reads about 0.4 MB and 1.7 MB for them and 12.5 MB for arktype.
 */

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

const heapBytes = (): number => heapStats().heapSize
const liveObjects = (): number => heapStats().objectCount

Bun.gc(true)
const heapAfterLoad = heapBytes()
const liveObjectsAfterLoad = liveObjects()
if (name !== "baseline" && !parse(validPayload)) {
  throw new Error(`${name} rejected the valid payload`)
}

let accepted = 0
let peakHeap = heapBytes()
for (let i = 0; i < memoryParses; i++) {
  if (parse(name === "baseline" ? undefined : validPayload)) accepted++
  // Sampled every 1,024 parses, between collections, so this is a sampled peak, not an exact one.
  if ((i & 1023) === 0) peakHeap = Math.max(peakHeap, heapBytes())
}
Bun.gc(true)
const heapAfterWork = heapBytes()
const liveObjectsAfterWork = liveObjects()

console.log(
  JSON.stringify({
    library: name,
    heapAfterLoad,
    liveObjectsAfterLoad,
    peakHeap,
    heapAfterWork,
    liveObjectsAfterWork,
    peakRss: vmHwmBytes(),
    accepted,
  }),
)
