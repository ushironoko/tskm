// Runs the compiler's test files under Node, from the source. Every top-level `*.test.ts` file
// runs here except the Bun-only files below. Those import bun:test or bun:ffi directly because
// they need Bun's own runtime, so they run only under `bun test`.
//
// Run `bun run build` first. Under Node the fixtures resolve `@tskm/core` through node_modules
// (the Bun run uses tsconfig paths), and that resolves to the built dist.
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const testDir = fileURLToPath(new URL("../packages/compiler/test/", import.meta.url))

/** The Bun-only files, and why each one cannot run under Node. */
const BUN_ONLY = new Map([
  [
    "bun-sync-fds.test.ts",
    "unit tests of Bun's child-process fd shim (src/bun-sync-fds.ts); fd-status.ts reads fds through bun:ffi",
  ],
  [
    "tsgo-client.integration.test.ts",
    "the /dev/fd fallback test drives Bun's fd shim and bun:ffi; its shared overlay suite also runs under Node (node-integration.ts)",
  ],
  [
    "recursive-hub.integration.test.ts",
    "the fixture's hub specifiers (@validator, @foreign) resolve through tsconfig paths at run time; Node ignores paths and cannot link a bare scope from node_modules",
  ],
])

const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()

// A listed file must still need Bun. Otherwise it would drop out of the Node run without notice.
for (const name of BUN_ONLY.keys()) {
  const source = files.includes(name) ? readFileSync(join(testDir, name), "utf8") : ""
  if (!/from "bun(:test|:ffi)"/.test(source)) {
    throw new Error(`${name} is listed as Bun-only but does not import bun:test or bun:ffi`)
  }
}

const nodeFiles = files.filter((name) => !BUN_ONLY.has(name)).map((name) => join(testDir, name))

// One file at a time: the scenarios share fixture paths, and bun test also runs files in turn.
const result = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--test",
    "--test-concurrency=1",
    "--test-reporter=spec",
    ...nodeFiles,
  ],
  { stdio: "inherit" },
)
process.exitCode = result.status ?? 1
