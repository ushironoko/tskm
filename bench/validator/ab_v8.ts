// node has no global `Bun`; measure.ts only reads `Bun.nanoseconds`. Provide just that one
// method on node. The cast targets the minimal consumed shape (not the full Bun namespace) —
// the weakest assertion that lets a partial shim satisfy the global slot on node.
;(globalThis as { Bun?: { nanoseconds: () => number } }).Bun ??= {
  nanoseconds: () => Number(process.hrtime.bigint()),
}

import { consume, makeConsume } from "./sink.ts"

interface ABResult {
  readonly name: string
  readonly interpreted: BenchResult
  readonly compiled: BenchResult
  readonly ratio: number
}

interface BenchResult {
  readonly nsPerOp: number
  readonly nsPerOpMin: number
  readonly nsPerOpP99: number
}

interface ValidatorFixture {
  readonly name: string
  readonly schema: import("../../packages/tskm/src/index.ts").BaseSchema<unknown, unknown>
  readonly input: unknown
  readonly config?: import("../../packages/tskm/src/index.ts").Config | undefined
}

interface InterleavedResult {
  readonly interpreted: BenchResult
  readonly compiled: BenchResult
  readonly ratio: number
  readonly iterationsPerOp: number
  readonly fixtureCount: number
  readonly regressed: boolean
}

const interleavedIterationsPerOp = 64

async function run(): Promise<void> {
  const [measure, tskm, compiledModule, conformance] = await Promise.all([
    import("../lib/measure.ts"),
    import("../../packages/tskm/src/index.ts"),
    import("../../packages/tskm/src/compile.ts"),
    import("./conformance.ts"),
  ])

  const conformanceSummary = conformance.runConformance()
  console.log(`conformance: PASS casesChecked=${conformanceSummary.casesChecked}`)

  const results: ABResult[] = []
  for (const fixture of conformance.createBenchmarkFixtures()) {
    // Per-fixture consume so reads stay monomorphic to this fixture (see sink.makeConsume);
    // the interleaved guard below keeps a shared consume because exercising many shapes is
    // exactly its purpose.
    const consumeOne = makeConsume()
    const interpreted = measure.bench(`${fixture.name}:interpreter`, () =>
      consumeOne(tskm.safeParse(fixture.schema, fixture.input, fixture.config)),
    )
    const compiled = measure.bench(`${fixture.name}:compiled`, () =>
      consumeOne(compiledModule.safeParseCompiled(fixture.schema, fixture.input, fixture.config)),
    )
    results.push({
      name: fixture.name,
      interpreted,
      compiled,
      ratio: interpreted.nsPerOp / compiled.nsPerOp,
    })
  }

  const interleaved = runInterleavedGuard(measure, tskm, compiledModule)
  measure.sink.value = interleaved

  console.log("\n# validator A/B (node/V8)\n")
  console.log(renderABTable(results))
  console.log(`\n# V8 ${interleaved.fixtureCount}-schema interleaved megamorphism guard\n`)
  console.log(renderInterleaved(interleaved))
  console.log("")
}

function runInterleavedGuard(
  measure: typeof import("../lib/measure.ts"),
  tskm: typeof import("../../packages/tskm/src/index.ts"),
  compiledModule: typeof import("../../packages/tskm/src/compile.ts"),
): InterleavedResult {
  const fixtures = createInterleavedFixtures(tskm)
  for (const fixture of fixtures) {
    compiledModule.getCompiledValidate(fixture.schema)
  }

  let interpreterOffset = 0
  let compiledOffset = 0
  let interpreterAccumulator = 0
  let compiledAccumulator = 0

  const interpreted = measure.bench(`interleaved-${fixtures.length}:interpreter`, () => {
    let local = 0
    for (let i = 0; i < interleavedIterationsPerOp; i++) {
      const index = (interpreterOffset + i) % fixtures.length
      const fixture = fixtures[index] as ValidatorFixture
      local += consume(tskm.safeParse(fixture.schema, fixture.input))
    }
    interpreterOffset = (interpreterOffset + 1) % fixtures.length
    interpreterAccumulator += local
    return interpreterAccumulator
  })

  const compiled = measure.bench(`interleaved-${fixtures.length}:compiled`, () => {
    let local = 0
    for (let i = 0; i < interleavedIterationsPerOp; i++) {
      const index = (compiledOffset + i) % fixtures.length
      const fixture = fixtures[index] as ValidatorFixture
      local += consume(compiledModule.safeParseCompiled(fixture.schema, fixture.input))
    }
    compiledOffset = (compiledOffset + 1) % fixtures.length
    compiledAccumulator += local
    return compiledAccumulator
  })

  const ratio = interpreted.nsPerOp / compiled.nsPerOp
  measure.sink.value = { interpreterAccumulator, compiledAccumulator }
  return {
    interpreted,
    compiled,
    ratio,
    iterationsPerOp: interleavedIterationsPerOp,
    fixtureCount: fixtures.length,
    regressed: ratio < 1,
  }
}

function createInterleavedFixtures(
  tskm: typeof import("../../packages/tskm/src/index.ts"),
): readonly ValidatorFixture[] {
  const {
    object,
    array,
    string,
    number,
    boolean,
    optional,
    nullish,
    union,
    pipe,
    minLength,
    minValue,
  } = tskm
  type Sch = import("../../packages/tskm/src/index.ts").BaseSchema<unknown, unknown>
  const fixtures: ValidatorFixture[] = []

  // 8 flat objects, widths 1..8 with distinct keys/types: distinct compiled closures from the
  // same object factory — the mrale.ph shared-inline-cache stress the 8-schema guard was too
  // narrow to expose.
  for (let w = 1; w <= 8; w++) {
    const entries: Record<string, Sch> = {}
    const input: Record<string, unknown> = {}
    for (let i = 0; i < w; i++) {
      const k = `f${w}k${i}`
      const kind = i % 3
      entries[k] = kind === 0 ? string() : kind === 1 ? number() : boolean()
      input[k] = kind === 0 ? `s${i}` : kind === 1 ? i : i % 2 === 0
    }
    fixtures.push({ name: `flat-${w}`, schema: object(entries), input })
  }

  // 6 nested-non-leaf objects (depth 3) — exercises nested compiled object steps under the load.
  for (let d = 0; d < 6; d++) {
    const inner = object({ a: string(), b: number(), c: optional(string()) })
    const schema = object({
      id: string(),
      data: object({ x: inner, y: array(number()) }),
      n: number(),
    })
    fixtures.push({
      name: `nested-${d}`,
      schema,
      input: { id: `n${d}`, data: { x: { a: "a", b: d, c: "c" }, y: [1, 2, d] }, n: d },
    })
  }

  // 4 arrays-of-objects, element widths 2..5 — the shape that regresses on JSC.
  for (let e = 0; e < 4; e++) {
    const width = e + 2
    const entries: Record<string, Sch> = {}
    const row: Record<string, unknown> = {}
    for (let i = 0; i < width; i++) {
      entries[`c${i}`] = i % 2 === 0 ? number() : string()
      row[`c${i}`] = i % 2 === 0 ? i : `v${i}`
    }
    fixtures.push({
      name: `aoo-${width}`,
      schema: array(object(entries)),
      input: [row, { ...row }, { ...row }],
    })
  }

  // 4 with optional/nullish leaves (faithful-optional drop paths in the load).
  for (let o = 0; o < 4; o++) {
    const schema = object({
      req: string(),
      opt: optional(string()),
      maybe: nullish(number()),
      tag: number(),
    })
    fixtures.push({
      name: `opt-${o}`,
      schema,
      input: o % 2 === 0 ? { req: "r", opt: "o", maybe: o, tag: o } : { req: "r", tag: o },
    })
  }

  // 4 with a union child — routed through the fallback closure (interpreter ~run).
  for (let u = 0; u < 4; u++) {
    const schema = object({ k: string(), v: union([string(), number()]), w: number() })
    fixtures.push({
      name: `union-${u}`,
      schema,
      input: { k: "k", v: u % 2 === 0 ? `s${u}` : u, w: u },
    })
  }

  // 4 with piped children — also fallback; mixes specialized + fallback steps in one tree.
  for (let p = 0; p < 4; p++) {
    const schema = object({
      name: pipe(string(), minLength(2)),
      score: pipe(number(), minValue(0)),
      flag: boolean(),
    })
    fixtures.push({
      name: `piped-${p}`,
      schema,
      input: { name: `nm${p}`, score: p, flag: p % 2 === 0 },
    })
  }

  return fixtures
}

function renderABTable(results: readonly ABResult[]): string {
  const rows = [
    [
      "fixture",
      "interp ns/op",
      "compiled ns/op",
      "ratio",
      "interp min/p50/p99",
      "compiled min/p50/p99",
    ],
    ...results.map((result) => [
      result.name,
      formatNs(result.interpreted.nsPerOp),
      formatNs(result.compiled.nsPerOp),
      `${result.ratio.toFixed(2)}x`,
      formatTriplet(result.interpreted),
      formatTriplet(result.compiled),
    ]),
  ]
  const header = rows[0] as string[]
  const widths = header.map((_, col) => Math.max(...rows.map((row) => (row[col] as string).length)))
  return rows
    .map((row, index) => {
      const line = row
        .map((cell, col) => (cell as string).padEnd(widths[col] as number))
        .join(" | ")
      if (index === 0) {
        return `${line}\n${widths.map((width) => "-".repeat(width)).join("-|-")}`
      }
      return line
    })
    .join("\n")
}

function renderInterleaved(result: InterleavedResult): string {
  const interpretedPerValidation = result.interpreted.nsPerOp / result.iterationsPerOp
  const compiledPerValidation = result.compiled.nsPerOp / result.iterationsPerOp
  return [
    `interpreter ns/op: ${formatNs(result.interpreted.nsPerOp)} batch, ${formatNs(interpretedPerValidation)} per validation`,
    `compiled ns/op:    ${formatNs(result.compiled.nsPerOp)} batch, ${formatNs(compiledPerValidation)} per validation`,
    `ratio:             ${result.ratio.toFixed(2)}x`,
    `compiled regressed below 1.0x: ${result.regressed ? "yes" : "no"}`,
  ].join("\n")
}

function formatTriplet(result: BenchResult): string {
  return `${formatNs(result.nsPerOpMin)}/${formatNs(result.nsPerOp)}/${formatNs(result.nsPerOpP99)}`
}

function formatNs(value: number): string {
  return value.toFixed(value >= 100 ? 1 : 2)
}

await run()
