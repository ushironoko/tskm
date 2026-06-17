/**
 * Full-materializing sink + a no-regression gate for the validator A/B benches.
 *
 * Parking only the `SafeParseResult` object (the default `measure.ts` sink) lets V8's escape
 * analysis scalar-replace the output object/array the validator just built — because nothing
 * ever reads its fields. That deletes the very allocation the compiled path pays for and
 * inflates its apparent speed. A PARTIAL checksum (reading a few fields) inflates the OTHER
 * way: V8 elides the unread fields' construction. So {@link consume} reads EVERY field of
 * the result — success, the whole output tree, and every issue — folding them into one
 * number. Both the interpreter and the compiled fn pay the identical fold, so the ratio
 * stays fair while reflecting the real cost a consumer pays (you validate in order to READ
 * the output).
 */

interface SinkableIssue {
  readonly message: string
  readonly path?: readonly unknown[] | undefined
}

interface SinkableResult {
  readonly success: boolean
  readonly output: unknown
  readonly issues?: readonly SinkableIssue[] | undefined
}

/**
 * Returns a FRESH consume closure with its own inline-cache sites. Give EACH benchmarked
 * fixture its own instance: a single shared `consume` reading many different output shapes
 * (all fixtures in one process) goes megamorphic on JSC and distorts the per-fixture ratio —
 * it can even read array-of-objects as a regression, although isolated monomorphic usage
 * (the realistic case: real code consumes each schema's output through its own call site) is
 * a clear win on both engines. One consume per fixture keeps each measurement's reads
 * monomorphic to that fixture's shape.
 */
export function makeConsume(): (result: SinkableResult) => number {
  const fold = (value: unknown, acc: number): number => {
    if (value === null) {
      return acc + 1
    }
    const t = typeof value
    if (t === "string") {
      return acc + (value as string).length
    }
    if (t === "number") {
      return acc + (Number.isNaN(value) ? 0 : (value as number))
    }
    if (t === "boolean") {
      return acc + (value ? 1 : 0)
    }
    if (Array.isArray(value)) {
      let a = acc + value.length
      for (let i = 0; i < value.length; i++) {
        a = fold(value[i], a)
      }
      return a
    }
    if (t === "object") {
      let a = acc
      for (const key of Object.keys(value as Record<string, unknown>)) {
        a += key.length
        a = fold((value as Record<string, unknown>)[key], a)
      }
      return a
    }
    return acc
  }
  return (result) => {
    let acc = result.success ? 1 : 0
    acc = fold(result.output, acc)
    const issues = result.issues
    if (issues !== undefined) {
      acc += issues.length
      for (let i = 0; i < issues.length; i++) {
        const issue = issues[i] as SinkableIssue
        acc += issue.message.length
        const path = issue.path
        if (path !== undefined) {
          acc += path.length
        }
      }
    }
    return acc
  }
}

/** Shared default instance; prefer `makeConsume()` per fixture to avoid cross-shape megamorphism. */
export const consume = makeConsume()

/** Per-fixture ratio (interpreter ns/op ÷ compiled ns/op). */
export interface RatioRow {
  readonly name: string
  readonly ratio: number
}

/**
 * Bare top-level primitives are a DOCUMENTED non-target: `safeParseCompiled` carries a small
 * constant entry overhead on a sub-25ns parse that delegating cannot remove (it is the cost
 * of the separate entry point, not of compilation), so a bare scalar should use `safeParse`.
 * The gate skips them and enforces no-regression only on the compiled path's real targets.
 */
const BARE_PRIMITIVES: ReadonlySet<string> = new Set([
  "primitive/string",
  "primitive/number",
  "primitive/boolean",
])

/** Aspirational targets (reported, not failed — `object/flat` is genuinely marginal). */
const NAMED_BARS: Readonly<Record<string, number>> = {
  "object/flat": 1.3,
  "array/object-50": 1.6,
}

export interface GateResult {
  readonly failed: boolean
  readonly lines: readonly string[]
}

/**
 * Fails (for a CI exit code) if any compiled TARGET fixture regresses below 1.0x. Bare
 * primitives are skipped (documented non-targets). Named aspirational bars are reported as
 * warnings, never hard failures, so normal machine noise on the marginal `object/flat` case
 * cannot make the bench flaky.
 */
export function gateRegressions(rows: readonly RatioRow[]): GateResult {
  const lines: string[] = []
  let failed = false
  for (const row of rows) {
    const ratio = row.ratio.toFixed(2)
    if (BARE_PRIMITIVES.has(row.name)) {
      lines.push(
        `  skip ${row.name} ${ratio}x — bare primitive, use safeParse (documented entry cost)`,
      )
      continue
    }
    if (row.ratio < 1.0) {
      failed = true
      lines.push(`  FAIL ${row.name} ${ratio}x < 1.00x — regression on a compiled target`)
      continue
    }
    const bar = NAMED_BARS[row.name]
    if (bar !== undefined && row.ratio < bar) {
      lines.push(
        `  warn ${row.name} ${ratio}x — below ${bar.toFixed(2)}x aspirational bar (no regression)`,
      )
    } else {
      lines.push(`  ok   ${row.name} ${ratio}x`)
    }
  }
  return { failed, lines }
}
