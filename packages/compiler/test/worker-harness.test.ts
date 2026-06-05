import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildExportNames,
  isExtractableSchema,
  isTskmWalkable,
  readStandard,
  runSchemaWorker,
  runWorker,
} from "../src/worker-harness.ts"

// Resolve a real `bun` on PATH the same way the integration tests do: the runWorker
// failure cases spawn throwaway worker scripts, so they need a TS-capable runtime as
// the worker exec path. When bun is absent we skip those cases rather than hard-fail.
function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

const tmpDirs: string[] = []
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tskm-worker-harness-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const RUN_OPTS = (root: string) => ({ root, timeoutMs: 5000, tag: "test" }) as const

describe.skipIf(!bun)("runWorker — the four failure branches collapse to a diagnostic", () => {
  // Each branch is a fail-closed guard: a misbehaving (or missing) worker must never
  // surface an envelope, only a single `diagnostic` string the caller can skip on.

  it("spawn error -> 'worker failed' diagnostic (execPath does not exist)", () => {
    // spawnSync surfaces an ENOENT via `child.error`; this is the only branch that
    // never even starts a process, so it must be reported without touching the envelope.
    const dir = freshDir()
    const workerAbs = join(dir, "worker.mjs")
    writeFileSync(workerAbs, "// never runs\n")
    const result = runWorker(workerAbs, join(dir, "src.ts"), {
      ...RUN_OPTS(dir),
      execPath: "/no/such/bin",
    })
    expect(result.diagnostic).toMatch(/worker failed/)
    expect(result.envelope).toBeUndefined()
  })

  it("non-zero exit -> 'worker exited with code 2' diagnostic", () => {
    // A worker that crashes BEFORE writing an envelope is detected via exit status,
    // not envelope contents, so the parent can distinguish it from an in-envelope error.
    const dir = freshDir()
    const workerAbs = join(dir, "worker.mjs")
    writeFileSync(workerAbs, "process.exit(2)\n")
    const result = runWorker(workerAbs, join(dir, "src.ts"), {
      ...RUN_OPTS(dir),
      execPath: bun as string,
    })
    expect(result.diagnostic).toMatch(/worker exited with code 2/)
    expect(result.envelope).toBeUndefined()
  })

  it("unreadable envelope -> 'could not read worker output' diagnostic", () => {
    // The worker exits 0 but never creates the envelope file; readFileSync throws and
    // the harness must translate that into a skip rather than propagate the exception.
    const dir = freshDir()
    const workerAbs = join(dir, "worker.mjs")
    writeFileSync(workerAbs, "// exits 0, writes nothing\n")
    const result = runWorker(workerAbs, join(dir, "src.ts"), {
      ...RUN_OPTS(dir),
      execPath: bun as string,
    })
    expect(result.diagnostic).toMatch(/could not read worker output/)
    expect(result.envelope).toBeUndefined()
  })

  it("in-envelope error -> '<error>; skipped' diagnostic (exit 0)", () => {
    // The worker exits 0 but reports a user-module failure THROUGH the envelope's
    // error channel; the harness must lift that message into the diagnostic.
    const dir = freshDir()
    const workerAbs = join(dir, "worker.mjs")
    // process.argv[3] is the envelope path (argv[0]=runtime, [1]=script, [2]=source).
    writeFileSync(
      workerAbs,
      'import { writeFileSync } from "node:fs"\n' +
        'writeFileSync(process.argv[3], JSON.stringify({ error: "boom" }))\n',
    )
    const result = runWorker(workerAbs, join(dir, "src.ts"), {
      ...RUN_OPTS(dir),
      execPath: bun as string,
    })
    expect(result.diagnostic).toMatch(/boom; skipped/)
    expect(result.envelope).toBeUndefined()
  })
})

describe("buildExportNames — identity map from exports to display names", () => {
  // Duck-typed schema objects: isSchema only checks `kind === "schema"`, so no
  // @tskm/core import is needed to exercise the map builder.
  const schema = (tag: string) => ({ kind: "schema", tag })

  it("first export wins when two exports alias the SAME object", () => {
    // `export const b = a` aliases one object under two names; the name must be stable
    // regardless of re-export order, so the FIRST binding seen wins (map.has guard).
    const a = schema("a")
    const mod = { a, b: a }
    const names = buildExportNames(mod, (n) => n.toUpperCase())
    expect(names.get(a)).toBe("A")
    expect(names.size).toBe(1)
  })

  it("skips non-schema exports", () => {
    // Plain values (helpers, constants) must never enter the identity map; only
    // objects whose `kind` is "schema" are nameable targets.
    const s = schema("s")
    const mod = { s, helper: 42, cfg: { kind: "config" }, nil: null }
    const names = buildExportNames(mod, (n) => n)
    expect(names.size).toBe(1)
    expect(names.get(s)).toBe("s")
  })

  it("applies the rename function to the emitted name", () => {
    // The workers pass `deriveTypeName` so the map name matches discovery's typeName;
    // here a stand-in rename proves the binding name is routed through `rename`.
    const s = schema("user")
    const names = buildExportNames({ userSchema: s }, (n) => `T_${n}`)
    expect(names.get(s)).toBe("T_userSchema")
  })
})

describe("runSchemaWorker — worker-side argv/envelope protocol (in process)", () => {
  // Drive the worker half directly by setting process.argv[2]=source, [3]=envelope.
  // argv is process-global, so it is always restored in `finally`.

  it("writes one envelope entry per schema export via the extract callback", async () => {
    const dir = freshDir()
    // Fixture exports two schemas + a non-schema; isSchema only checks `kind`.
    const fixture = join(dir, "fixture.ts")
    writeFileSync(
      fixture,
      'export const foo = { kind: "schema" }\n' +
        'export const bar = { kind: "schema" }\n' +
        "export const helper = 7\n",
    )
    const envelope = join(dir, "envelope.json")
    const savedArgv = process.argv
    try {
      process.argv = [savedArgv[0] as string, savedArgv[1] as string, fixture, envelope]
      await runSchemaWorker((name) => ({ name }))
    } finally {
      process.argv = savedArgv
    }
    const parsed = JSON.parse(readFileSync(envelope, "utf8")) as {
      schemas?: ReadonlyArray<{ name: string }>
      error?: string
    }
    expect(parsed.error).toBeUndefined()
    // Export iteration order is not contractual (the ESM namespace may sort keys), so
    // assert on the set of names: one entry per schema export, the non-schema dropped.
    expect(parsed.schemas?.map((s) => s.name).sort()).toEqual(["bar", "foo"])
  })

  it("emits { error: 'no source path provided' } when argv[2] is missing", async () => {
    // The source-path guard fails closed THROUGH the envelope (exit 0), so the parent
    // reads it as a skippable error rather than a crashed worker.
    const dir = freshDir()
    const envelope = join(dir, "envelope.json")
    const savedArgv = process.argv
    try {
      // argv[2] (source) intentionally undefined; argv[3] (envelope) present.
      process.argv = [savedArgv[0] as string, savedArgv[1] as string]
      process.argv[3] = envelope
      await runSchemaWorker((name) => ({ name }))
    } finally {
      process.argv = savedArgv
    }
    const parsed = JSON.parse(readFileSync(envelope, "utf8")) as { error?: string }
    expect(parsed.error).toBe("no source path provided")
  })
})

describe("runSchemaWorker — guard branches (in-process)", () => {
  it("writes the guard message to stderr and sets exitCode when argv[3] is missing", async () => {
    // Without an envelope path the worker cannot report through the protocol at all,
    // so this is the one branch that signals through stderr + a non-zero exit code.
    const savedArgv = process.argv
    const savedExit = process.exitCode
    const savedWrite = process.stderr.write
    let captured = ""
    try {
      process.argv = [savedArgv[0] as string, savedArgv[1] as string]
      process.stderr.write = ((chunk: string | Uint8Array) => {
        captured += String(chunk)
        return true
      }) as typeof process.stderr.write
      await runSchemaWorker((name) => ({ name }))
    } finally {
      process.argv = savedArgv
      process.stderr.write = savedWrite
      process.exitCode = savedExit
    }
    expect(captured).toContain("requires an envelope output path")
  })

  it("reports a throwing user module through the envelope (exit stays 0)", async () => {
    // An import-time crash of the USER module must be distinguishable from a crashed
    // worker: it lands in the envelope's error channel, never in the exit code.
    const dir = freshDir()
    const moduleAbs = join(dir, "explodes.ts")
    writeFileSync(moduleAbs, 'throw new Error("boom-import")\n')
    const envelope = join(dir, "envelope.json")
    const savedArgv = process.argv
    try {
      process.argv = [savedArgv[0] as string, savedArgv[1] as string, moduleAbs, envelope]
      await runSchemaWorker((name) => ({ name }))
    } finally {
      process.argv = savedArgv
    }
    const parsed = JSON.parse(readFileSync(envelope, "utf8")) as { error?: string }
    expect(parsed.error).toContain("boom-import")
  })
})

describe("readStandard / isExtractableSchema / isTskmWalkable — two-stage detection", () => {
  const std = (vendor: string) => ({
    "~standard": { version: 1, vendor, validate: () => ({ value: 1 }) },
  })
  // tskm follows the valibot architecture, so BOTH carry kind:"schema" — only the
  // ~standard vendor can tell them apart. That is exactly why extraction and
  // walkability must be separate predicates.
  const tskmLike = { kind: "schema", ...std("tskm") }
  const legacyTskmLike = { kind: "schema" }
  const valibotLike = { kind: "schema", ...std("valibot") }
  const zodLike = std("zod")
  const arktypeLike = std("arktype")

  it("readStandard reads vendor/version from a conforming object", () => {
    expect(readStandard(zodLike)).toEqual({ vendor: "zod", version: 1 })
    expect(readStandard(tskmLike)).toEqual({ vendor: "tskm", version: 1 })
  })

  it("readStandard rejects null, primitives, and malformed markers", () => {
    expect(readStandard(null)).toBeUndefined()
    expect(readStandard(42)).toBeUndefined()
    expect(readStandard({})).toBeUndefined()
    expect(readStandard({ "~standard": {} })).toBeUndefined()
    expect(readStandard({ "~standard": { version: "1", vendor: "zod" } })).toBeUndefined()
    expect(readStandard({ "~standard": { version: 1, vendor: 7 } })).toBeUndefined()
  })

  it("isExtractableSchema accepts every Standard Schema vendor plus legacy tskm", () => {
    expect(isExtractableSchema(zodLike)).toBe(true)
    expect(isExtractableSchema(valibotLike)).toBe(true)
    expect(isExtractableSchema(arktypeLike)).toBe(true)
    expect(isExtractableSchema(tskmLike)).toBe(true)
    expect(isExtractableSchema(legacyTskmLike)).toBe(true)
  })

  it("isExtractableSchema rejects non-schemas", () => {
    expect(isExtractableSchema({ kind: "config" })).toBe(false)
    expect(isExtractableSchema({})).toBe(false)
    expect(isExtractableSchema(null)).toBe(false)
    expect(isExtractableSchema(42)).toBe(false)
  })

  it("isTskmWalkable REJECTS a valibot schema despite its kind:'schema'", () => {
    // The accident this prevents: valibot objects satisfy the legacy kind check, so
    // without the vendor gate the tskm structural/JSON walkers would walk them.
    expect(isTskmWalkable(valibotLike)).toBe(false)
  })

  it("isTskmWalkable rejects other external vendors", () => {
    expect(isTskmWalkable(zodLike)).toBe(false)
    expect(isTskmWalkable(arktypeLike)).toBe(false)
  })

  it("isTskmWalkable accepts tskm schemas (with and without ~standard)", () => {
    expect(isTskmWalkable(tskmLike)).toBe(true)
    expect(isTskmWalkable(legacyTskmLike)).toBe(true)
  })
})
