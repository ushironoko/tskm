import { expect } from "bun:test"
import type { StandardSchemaV1 } from "../src/types/standard.ts"

/**
 * Reusable Standard Schema conformance harness (issue #23).
 *
 * Per-primitive issues append their new schema to the case table in
 * `standard-contract.test.ts`, which drives every case through
 * {@link assertStandardSchemaConformance}. The harness is the enforced form of the
 * section 1, 3, and 6 requirements in `docs/primitive-contract.md`.
 */

/**
 * The ONLY keys an external Standard Schema issue may carry. The internal issue is
 * rich (`kind`/`type`/`expected`/`received`/`input`, plus any future severity-like
 * field), but `_getStandardProps` projects it down to `{ message, path? }`. This
 * allowlist is the regression guard for that projection: anything else on a returned
 * issue is a leak. The diagnostics work co-designs its field names against this set
 * rather than relaxing it.
 */
const ALLOWED_ISSUE_KEYS: ReadonlySet<string> = new Set(["message", "path"])

export interface ConformanceCase {
  readonly name: string
  readonly schema: StandardSchemaV1
  /** `true` if the schema runs on the async path (validate returns a Promise). */
  readonly async: boolean
  /** A value the schema accepts. Omit only when the schema has no accepting input. */
  readonly valid?: unknown
  /** A value the schema rejects. Omit only when the schema rejects nothing. */
  readonly invalid?: unknown
}

function assertSyncness(result: unknown, isAsync: boolean): void {
  if (isAsync) {
    expect(result).toBeInstanceOf(Promise)
  } else {
    expect(result).not.toBeInstanceOf(Promise)
  }
}

function assertNoLeak(issues: ReadonlyArray<StandardSchemaV1.Issue>): void {
  expect(issues.length).toBeGreaterThan(0)
  for (const issue of issues) {
    for (const key of Object.keys(issue)) {
      if (!ALLOWED_ISSUE_KEYS.has(key)) {
        throw new Error(
          `Standard Schema issue leaked the internal field "${key}"; only { message, path? } may cross the boundary`,
        )
      }
    }
    expect(typeof issue.message).toBe("string")
    if (issue.path !== undefined) {
      for (const segment of issue.path) {
        assertPathSegment(segment)
      }
    }
  }
}

function isPropertyKey(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "symbol"
}

/**
 * A path segment is a bare PropertyKey or a `{ key }` PathSegment carrying ONLY `key`.
 * The object branch polices both the key set and the key type, so an internal field
 * cannot ride along on a path segment the way the top-level allowlist forbids it on the
 * issue itself.
 */
function assertPathSegment(segment: unknown): void {
  if (typeof segment === "object") {
    if (segment === null || !("key" in segment)) {
      throw new Error("Standard Schema path segment is not a { key } PathSegment")
    }
    const keys = Object.keys(segment)
    if (keys.length !== 1 || keys[0] !== "key") {
      throw new Error(
        `Standard Schema path segment leaked a non-key field: ${JSON.stringify(keys)}`,
      )
    }
    if (!isPropertyKey((segment as { key: unknown }).key)) {
      throw new Error("Standard Schema path segment key is not a PropertyKey")
    }
    return
  }
  expect(isPropertyKey(segment)).toBe(true)
}

/**
 * Asserts that a schema conforms to the Standard Schema contract: version/vendor,
 * sync-returns-sync vs async-returns-Promise, the success/failure-by-issues rule,
 * a `~standard.types` shape of input/output only when present, and the strict
 * `{ message, path? }` issue allowlist on the reject path.
 */
export async function assertStandardSchemaConformance(c: ConformanceCase): Promise<void> {
  const std = c.schema["~standard"]

  expect(std.version).toBe(1)
  expect(typeof std.vendor).toBe("string")
  expect(std.vendor.length).toBeGreaterThan(0)
  expect(std.validate.length).toBeGreaterThanOrEqual(1)

  // `~standard.types` is a type-level-only phantom: present in the type, absent at
  // runtime (so `std.types` is `undefined` here for tskm schemas). This runtime check is
  // therefore skipped for tskm, and only fires for a foreign Standard Schema that
  // attaches a real `types` object — guarding that, if present, it carries input/output.
  if (std.types !== undefined) {
    expect(Object.keys(std.types).sort()).toEqual(["input", "output"])
  }

  if ("valid" in c) {
    const result = std.validate(c.valid)
    assertSyncness(result, c.async)
    const settled = await result
    expect("issues" in settled && settled.issues !== undefined).toBe(false)
    // The success result must carry `value`, and only `value` (plus an optional
    // `issues: undefined`). This is the success-path analogue of the issue allowlist.
    expect("value" in settled).toBe(true)
    for (const key of Object.keys(settled)) {
      if (key !== "value" && key !== "issues") {
        throw new Error(`Standard Schema success result carried an unexpected key "${key}"`)
      }
    }
  }

  if ("invalid" in c) {
    const result = std.validate(c.invalid)
    assertSyncness(result, c.async)
    const settled = await result
    if (!("issues" in settled) || settled.issues === undefined) {
      throw new Error(`${c.name}: expected a failure result carrying issues`)
    }
    assertNoLeak(settled.issues)
  }
}
