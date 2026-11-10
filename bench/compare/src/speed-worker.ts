import { measuredIterations, warmupIterations } from "./config.ts"
import { invalidPayload, validPayload } from "./payload.ts"

/**
 * One library in one fresh process, for one measured round. `speed.ts` starts one of these per
 * library and round, in interleaved order, and reads the single JSON line it prints.
 *
 * `accepted` counts the verdicts. It is printed, so the parse results are consumed, and
 * `speed.ts` checks it (every valid parse accepted, every invalid parse rejected).
 */

type Parse = (input: unknown) => boolean

const name = process.argv[2]
if (!name) throw new Error("usage: bun src/speed-worker.ts <library>")
const { parse } = (await import(`./libs/${name}.ts`)) as { parse: Parse }

if (!parse(validPayload)) throw new Error(`${name} rejected the valid payload`)
if (parse(invalidPayload)) throw new Error(`${name} accepted the invalid payload`)

// The two payloads take different branches in every library, so each gets its own warmup.
for (let i = 0; i < warmupIterations; i++) parse(validPayload)
for (let i = 0; i < warmupIterations; i++) parse(invalidPayload)

function timed(input: unknown): { ns: number; accepted: number } {
  let accepted = 0
  const start = process.hrtime.bigint()
  for (let i = 0; i < measuredIterations; i++) {
    if (parse(input)) accepted++
  }
  return { ns: Number(process.hrtime.bigint() - start), accepted }
}

const valid = timed(validPayload)
const invalid = timed(invalidPayload)
console.log(
  JSON.stringify({
    library: name,
    validNs: valid.ns,
    validAccepted: valid.accepted,
    invalidNs: invalid.ns,
    invalidAccepted: invalid.accepted,
  }),
)
