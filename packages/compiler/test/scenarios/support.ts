import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { type FSWatcher, mkdirSync, mkdtempSync, readdirSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type * as Compiler from "../../src/index.ts"
import { testTsgoExecutable } from "../tsgo-test-executable.ts"

// Runtime-agnostic scenario support. Nothing here imports `bun:test` or `node:test`, and the
// compiler is always passed in as `api`, so the same scenarios run against the Bun source
// (`src/index.ts`) and against the built Node artifact (`dist/index.mjs`).

/** The compiler surface the scenarios drive. */
export type CompilerApi = Pick<
  typeof Compiler,
  | "FAILURE_TYPE_FLAGS"
  | "createTsgoClient"
  | "generate"
  | "generateJsonSchema"
  | "resolveTsgoExecutable"
  | "watch"
>

export interface Scenario {
  readonly name: string
  /** Milliseconds. The checker and the file watcher run in real time, so most scenarios set it. */
  readonly timeout?: number
  readonly run: () => void | Promise<void>
}

export interface Suite {
  readonly title: string
  /** Runs once after the suite's last scenario, even when one of them failed. */
  readonly teardown?: () => void | Promise<void>
  readonly scenarios: ReadonlyArray<Scenario>
}

/** An absolute path under `test/fixtures`. */
export function fixture(path: string): string {
  return fileURLToPath(new URL(`../fixtures/${path}`, import.meta.url))
}

export function contains(text: string, part: string): void {
  assert.ok(text.includes(part), `expected text to contain ${JSON.stringify(part)}:\n${text}`)
}

export function lacks(text: string, part: string): void {
  assert.ok(!text.includes(part), `expected text not to contain ${JSON.stringify(part)}:\n${text}`)
}

/** A throwaway project with one schema, opened through a tsconfig the checker can load. */
export function makeProject(): { root: string; tsconfig: string } {
  const root = mkdtempSync(join(tmpdir(), "tskm-sync-"))
  mkdirSync(join(root, "src"))
  const tsconfig = join(root, "tsconfig.json")
  writeFileSync(
    tsconfig,
    `${JSON.stringify({
      compilerOptions: {
        target: "es2022",
        module: "esnext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    })}\n`,
  )
  writeFileSync(
    join(root, "src/schema.ts"),
    `export const user = { id: 1 as number, name: "x" as string }\n`,
  )
  return { root, tsconfig }
}

/**
 * Runs `fn` and fails when a `*.tskm-query.ts` file was created, changed or removed under
 * `root` while it ran. Query documents are in-memory overlays, so none may reach the disk,
 * not even briefly. Each directory gets its own non-recursive watcher: those attach
 * synchronously, while a recursive watch attaches asynchronously and can miss a write made
 * right after it starts.
 */
export async function expectNoQueryWrites<T>(root: string, fn: () => Promise<T> | T): Promise<T> {
  const writes: string[] = []
  const watchers: FSWatcher[] = directoriesUnder(root).map((dir) =>
    watch(dir, (_event, name) => {
      if (name?.endsWith(".tskm-query.ts")) writes.push(join(dir, name))
    }),
  )
  let result: T
  try {
    result = await fn()
    // Watch events are delivered on the event loop, so let it run before reading them.
    await new Promise((resolve) => setTimeout(resolve, 50))
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    for (const watcher of watchers) watcher.close()
  }
  assert.deepEqual(writes, [], "query documents must never be written to disk")
  return result
}

function directoriesUnder(dir: string): string[] {
  const found = [dir]
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "node_modules") {
      found.push(...directoriesUnder(join(dir, entry.name)))
    }
  }
  return found
}

/** Runs `executable --noEmit -p tsconfig.json` in `projectRoot`: the emit-ability check. */
export function spawnNoEmit(
  executable: string,
  projectRoot: string,
): { ok: boolean; output: string } {
  const child = spawnSync(executable, ["--noEmit", "-p", "tsconfig.json"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 120_000,
    killSignal: "SIGKILL",
  })
  return { ok: child.status === 0, output: `${child.stdout ?? ""}${child.stderr ?? ""}` }
}

/**
 * The emit-ability check with the checker the scenarios use: the package's own binary, or the
 * one named by `TSKM_TEST_TSGO_EXECUTABLE`.
 */
export function tsgoNoEmit(
  api: Pick<CompilerApi, "resolveTsgoExecutable">,
  projectRoot: string,
): { ok: boolean; output: string } {
  return spawnNoEmit(api.resolveTsgoExecutable(testTsgoExecutable()), projectRoot)
}
