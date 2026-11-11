import {
  after,
  afterEach as afterEachNode,
  before,
  beforeEach as beforeEachNode,
  describe as describeNode,
  it as itNode,
} from "node:test"
import { expect } from "./node-expect.ts"

// The bun:test API the compiler tests use, on node:test. test-api.ts loads this module under
// Node and bun:test under Bun, so one test file runs on both. The differences are adapted here:
// bun:test's numeric timeout argument, its default timeout (node:test has none, so a stuck test
// would stall the run), `skipIf`, `it.each`, and the `beforeAll` / `afterAll` names.

/** bun:test's default timeout for a test or a hook, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 5_000

type Body = () => void | Promise<void>
type Rows = (...args: unknown[]) => void | Promise<void>

const timed = (timeout: number | undefined) => ({ timeout: timeout ?? DEFAULT_TIMEOUT_MS })

function describeSuite(name: string, body: () => void): void {
  describeNode(name, () => body())
}

export const describe = Object.assign(describeSuite, {
  skipIf: (skip: boolean) => (name: string, body: () => void) =>
    describeNode(name, { skip }, () => body()),
})

function itTest(name: string, body: Body, timeout?: number): void {
  itNode(name, timed(timeout), () => body())
}

export const it = Object.assign(itTest, {
  skipIf: (skip: boolean) => (name: string, body: Body, timeout?: number) =>
    itNode(name, { ...timed(timeout), skip }, () => body()),
  each: (table: ReadonlyArray<unknown>) => (name: string, body: Rows, timeout?: number) => {
    for (const row of table) {
      // bun:test spreads an array row into the arguments, and passes any other row as one argument.
      const args: ReadonlyArray<unknown> = Array.isArray(row) ? row : [row]
      itNode(formatName(name, args), timed(timeout), () => body(...args))
    }
  },
})

export const test = it

export const beforeAll = (body: Body, timeout?: number): void => {
  before(() => body(), timed(timeout))
}

export const afterAll = (body: Body, timeout?: number): void => {
  after(() => body(), timed(timeout))
}

export const beforeEach = (body: Body, timeout?: number): void => {
  beforeEachNode(() => body(), timed(timeout))
}

export const afterEach = (body: Body, timeout?: number): void => {
  afterEachNode(() => body(), timed(timeout))
}

export { expect }

/** The printf-style directives bun:test's `it.each` expands in test names: `%%` and one per arg. */
function formatName(name: string, args: ReadonlyArray<unknown>): string {
  let next = 0
  return name.replace(/%[sdifjoOp%]/g, (directive) => {
    if (directive === "%%") return "%"
    if (next >= args.length) return directive
    return String(args[next++])
  })
}
