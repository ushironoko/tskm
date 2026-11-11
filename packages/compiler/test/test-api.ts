import type * as BunTest from "bun:test"

// The test API the compiler tests import. Under Bun it is bun:test. Under Node it is the adapter
// in node-test-api.ts, so one test file runs unchanged on both runtimes. The adapter is loaded by
// dynamic import, so Bun never evaluates it and Node never resolves `bun:test`. Its types are
// held to bun:test's, so the tests type-check against the same API under either runtime.
//
// Files that need Bun's own runtime (bun:ffi, Bun's child-process fd shim, or tsconfig paths read
// at run time) import bun:test directly. They are Bun-only, and scripts/node-tests.mjs lists them.

type TestApi = typeof BunTest

const api: TestApi =
  process.versions.bun === undefined
    ? ((await import("./node-test-api.ts")) as unknown as TestApi)
    : await import("bun:test")

export const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } = api
