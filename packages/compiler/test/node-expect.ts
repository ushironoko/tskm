import assert from "node:assert/strict"
import { inspect } from "node:util"

// The `expect` surface the compiler tests use, for node:test (see node-test-api.ts). Each matcher
// follows bun:test, which is the reference run; it is not a Jest clone. A matcher that is not
// listed here does not exist, so a test that needs one fails with a TypeError instead of passing.
// The rules below were checked against bun:test one by one, including its array and undefined
// handling, so keep them in step with it.

/** Asymmetric matchers such as `expect.arrayContaining` decide equality on their own. */
interface AsymmetricMatcher {
  asymmetricMatch(received: unknown): boolean
}

/** What `toThrow` accepts: a message substring, a pattern, an error to match, or a class. */
export type ThrowExpectation = string | RegExp | Error | (new (...args: never[]) => unknown)

interface Matchers {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toMatchObject(expected: object): void
  toContain(item: unknown): void
  toHaveLength(length: number): void
  toMatch(expected: string | RegExp): void
  toStartWith(prefix: string): void
  toThrow(expected?: ThrowExpectation): void
  toBeDefined(): void
  toBeUndefined(): void
  toBeNull(): void
  toBeGreaterThan(value: number): void
  toBeGreaterThanOrEqual(value: number): void
  toBeLessThan(value: number): void
}

interface Expectation extends Matchers {
  readonly not: Matchers
  readonly rejects: { toThrow(expected?: ThrowExpectation): Promise<void> }
}

/** A thrown value, boxed so that a thrown `undefined` still counts as a throw. */
interface Thrown {
  readonly value: unknown
}

export function expect(received: unknown): Expectation {
  return {
    ...matchers(received, false),
    not: matchers(received, true),
    rejects: rejectsMatchers(received, false),
  }
}

expect.arrayContaining = (sample: ReadonlyArray<unknown>): AsymmetricMatcher => ({
  asymmetricMatch: (received) =>
    Array.isArray(received) &&
    sample.every((item) => received.some((value) => equals(value, item))),
})

function matchers(received: unknown, negated: boolean): Matchers {
  return {
    toBe: (expected) => {
      check(
        Object.is(received, expected),
        negated,
        `expected ${show(received)} to be ${show(expected)}`,
        received,
        expected,
      )
    },
    toEqual: (expected) => {
      check(
        equals(received, expected),
        negated,
        `expected ${show(received)} to equal ${show(expected)}`,
        received,
        expected,
      )
    },
    toMatchObject: (expected) => {
      check(
        matchesSubset(received, expected),
        negated,
        `expected ${show(received)} to match ${show(expected)}`,
        received,
        expected,
      )
    },
    toContain: (item) => {
      check(
        contains(received, item),
        negated,
        `expected ${show(received)} to contain ${show(item)}`,
        received,
        item,
      )
    },
    toHaveLength: (length) => {
      check(
        hasLength(received, length),
        negated,
        `expected ${show(received)} to have length ${length}`,
        received,
        length,
      )
    },
    toMatch: (expected) => {
      check(
        typeof received === "string" &&
          (typeof expected === "string" ? received.includes(expected) : expected.test(received)),
        negated,
        `expected ${show(received)} to match ${show(expected)}`,
        received,
        expected,
      )
    },
    toStartWith: (prefix) => {
      check(
        typeof received === "string" && received.startsWith(prefix),
        negated,
        `expected ${show(received)} to start with ${show(prefix)}`,
        received,
        prefix,
      )
    },
    toThrow: (expected) => {
      const thrown = call(received)
      check(
        thrown !== undefined && matchesThrown(thrown.value, expected),
        negated,
        `expected the function to throw ${describeExpected(expected)}`,
        thrown?.value,
        expected,
      )
    },
    toBeDefined: () => {
      check(received !== undefined, negated, "expected a defined value", received)
    },
    toBeUndefined: () => {
      check(received === undefined, negated, "expected undefined", received)
    },
    toBeNull: () => {
      check(received === null, negated, "expected null", received)
    },
    toBeGreaterThan: (value) => {
      check(
        typeof received === "number" && received > value,
        negated,
        `expected ${show(received)} to be greater than ${value}`,
        received,
        value,
      )
    },
    toBeGreaterThanOrEqual: (value) => {
      check(
        typeof received === "number" && received >= value,
        negated,
        `expected ${show(received)} to be greater than or equal to ${value}`,
        received,
        value,
      )
    },
    toBeLessThan: (value) => {
      check(
        typeof received === "number" && received < value,
        negated,
        `expected ${show(received)} to be less than ${value}`,
        received,
        value,
      )
    },
  }
}

function rejectsMatchers(received: unknown, negated: boolean): Expectation["rejects"] {
  return {
    toThrow: async (expected) => {
      const thrown = await settle(received)
      check(
        thrown !== undefined && matchesThrown(thrown.value, expected),
        negated,
        `expected the promise to reject with ${describeExpected(expected)}`,
        thrown?.value,
        expected,
      )
    },
  }
}

/** Fails the assertion when `pass` is the same as `negated`, i.e. the outcome is the wrong one. */
function check(
  pass: boolean,
  negated: boolean,
  message: string,
  actual?: unknown,
  expected?: unknown,
): void {
  if (pass === negated) {
    throw new assert.AssertionError({
      message: negated ? `expected not: ${message}` : message,
      actual,
      expected,
    })
  }
}

/** Calls `received`, which must be a function, and reports what it threw, if anything. */
function call(received: unknown): Thrown | undefined {
  if (typeof received !== "function") {
    throw new TypeError(`toThrow expects a function, received ${show(received)}`)
  }
  try {
    received()
  } catch (value) {
    return { value }
  }
  return undefined
}

async function settle(promise: unknown): Promise<Thrown | undefined> {
  try {
    await promise
  } catch (value) {
    return { value }
  }
  return undefined
}

function matchesThrown(thrown: unknown, expected: ThrowExpectation | undefined): boolean {
  if (expected === undefined) return true
  // bun:test matches the message of an Error, and the String() of anything else.
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  if (typeof expected === "string") return message.includes(expected)
  if (expected instanceof RegExp) return expected.test(message)
  if (expected instanceof Error) return message === expected.message
  return thrown instanceof expected
}

function describeExpected(expected: ThrowExpectation | undefined): string {
  return expected === undefined ? "an error" : show(expected)
}

/** `toContain`: a substring of a string, or an element of an iterable under `===`. */
function contains(received: unknown, item: unknown): boolean {
  if (typeof received === "string") return typeof item === "string" && received.includes(item)
  if (typeof received === "object" && received !== null && Symbol.iterator in received) {
    return Array.from(received as Iterable<unknown>).some((value) => value === item)
  }
  return false
}

function hasLength(received: unknown, length: number): boolean {
  // bun:test counts a Map or a Set by its size, and anything else by its length property.
  if (received instanceof Map || received instanceof Set) return received.size === length
  return (
    received !== null &&
    received !== undefined &&
    (received as { readonly length?: unknown }).length === length
  )
}

function isAsymmetric(value: unknown): value is AsymmetricMatcher {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<AsymmetricMatcher>).asymmetricMatch === "function"
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]"
}

/** The keys whose values are not `undefined`. Sparse and undefined-valued entries are absent. */
function definedKeys(value: object): string[] {
  const record = value as Record<string, unknown>
  return Object.keys(record).filter((key) => record[key] !== undefined)
}

/**
 * bun:test's `toEqual`: recursive, `Object.is` for primitives, ignores properties and array
 * entries whose value is `undefined` (so `[1]` equals `[1, undefined]`), does not compare class
 * or prototype, and compares Dates, RegExps, Errors (by name and message), Maps and Sets by content.
 */
function equals(a: unknown, b: unknown): boolean {
  if (isAsymmetric(b)) return b.asymmetricMatch(a)
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return (
      a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags
    )
  }
  if (a instanceof Error || b instanceof Error) {
    return a instanceof Error && b instanceof Error && a.name === b.name && a.message === b.message
  }
  if (a instanceof Map || b instanceof Map) {
    return (
      a instanceof Map &&
      b instanceof Map &&
      a.size === b.size &&
      [...a].every(([key, value]) => b.has(key) && equals(value, b.get(key)))
    )
  }
  if (a instanceof Set || b instanceof Set) {
    return (
      a instanceof Set &&
      b instanceof Set &&
      a.size === b.size &&
      [...a].every((item) => b.has(item) || [...b].some((other) => equals(item, other)))
    )
  }
  const keys = definedKeys(a)
  const other = b as Record<string, unknown>
  return (
    keys.length === definedKeys(b).length &&
    keys.every(
      (key) => Object.hasOwn(b, key) && equals((a as Record<string, unknown>)[key], other[key]),
    )
  )
}

/**
 * bun:test's `toMatchObject`: every property of `expected` must be present on `received` and
 * match, recursively. Arrays must have the same length, and each element is matched this way.
 */
function matchesSubset(received: unknown, expected: unknown): boolean {
  if (isAsymmetric(expected)) return expected.asymmetricMatch(received)
  if (Array.isArray(expected)) {
    return (
      Array.isArray(received) &&
      received.length === expected.length &&
      expected.every((item, index) => matchesSubset(received[index], item))
    )
  }
  if (isPlainObject(expected)) {
    if (typeof received !== "object" || received === null) return false
    const record = received as Record<string, unknown>
    return Object.keys(expected).every(
      (key) => key in record && matchesSubset(record[key], expected[key]),
    )
  }
  return equals(received, expected)
}

function show(value: unknown): string {
  return inspect(value)
}
