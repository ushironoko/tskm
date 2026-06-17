/**
 * Edge / no-eval smoke for the compiled fast path.
 *
 * The Tier-0 closure tree's whole reason to exist is that it uses NO `eval`/`new Function`,
 * so it runs where zod v4's JIT tier cannot: strict-CSP pages and edge runtimes (Cloudflare
 * Workers, Deno Deploy, Vercel Edge) that reject runtime code generation. This proves that by
 * EXECUTION, not by grepping the bundle: built to a bundle and run under
 * `node --disallow-code-generation-from-strings`, any `eval`/`Function(string)` would throw
 * `EvalError` — the exact error Cloudflare Workers raise ("Code generation from strings
 * disallowed"). If `safeParseCompiled` builds its closure tree and validates correctly here,
 * the no-eval property holds at runtime, not just in source.
 */
import {
  array,
  number,
  object,
  optional,
  safeParse,
  safeParseCompiled,
  string,
} from "../../packages/tskm/src/index.ts"

const schema = object({
  user: object({ id: string(), tags: array(string()), bio: optional(string()) }),
  items: array(object({ x: number(), label: string() })),
})

const good = {
  user: { id: "u", tags: ["a", "b"], bio: "hi" },
  items: [
    { x: 1, label: "p" },
    { x: 2, label: "q" },
  ],
}
const bad = { user: { id: 1, tags: [2] }, items: "nope" }

interface ParseLike {
  readonly success: boolean
  readonly output: unknown
  readonly issues?: readonly unknown[] | undefined
}

interface Summary {
  readonly success: boolean
  readonly output: string
  readonly issues: number
}

function summarize(result: ParseLike): Summary {
  return {
    success: result.success,
    output: JSON.stringify(result.success ? result.output : null),
    issues: result.issues?.length ?? 0,
  }
}

const cases: ReadonlyArray<readonly [string, unknown, boolean]> = [
  ["good", good, true],
  ["bad", bad, false],
]

let failures = 0
for (const [name, input, wantSuccess] of cases) {
  // safeParseCompiled compiles the schema into a closure tree and runs it. Under
  // --disallow-code-generation-from-strings this throws EvalError if it uses any codegen.
  const interpreted = summarize(safeParse(schema, input))
  const compiled = summarize(safeParseCompiled(schema, input))
  const matchesInterpreter =
    interpreted.success === compiled.success &&
    interpreted.output === compiled.output &&
    interpreted.issues === compiled.issues
  const ok = compiled.success === wantSuccess && matchesInterpreter
  console.log(
    `${name}: compiled.success=${compiled.success} matchesInterpreter=${matchesInterpreter} ${ok ? "OK" : "FAIL"}`,
  )
  if (!ok) {
    failures++
  }
}

const proc = (globalThis as { process?: { exitCode?: number } }).process
if (failures === 0) {
  console.log(
    "WORKERD-SMOKE PASS: safeParseCompiled built + ran its closure tree and validated under a no-eval runtime",
  )
} else {
  console.error(`WORKERD-SMOKE FAIL: ${failures} case(s)`)
  if (proc !== undefined) {
    proc.exitCode = 1
  }
}
