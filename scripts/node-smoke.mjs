// Node smoke test for the built CLI (packages/compiler/dist/cli.mjs). Run after `bun run build`.
//
// Runs the CLI under the Node that executes this script, once per example. Every generated
// `*.gen.ts` must be byte-identical to the file it replaces, a run must not add or remove a
// file, and no `*.tskm-query.ts` may remain. Query documents are in memory, so a sidecar run
// should leave none behind. The examples' `*.gen.ts` files are committed, so on a clean
// checkout this checks them against the committed output.
//
// The CLI writes into the examples. A file that changes is restored to its content from before
// the run, so a failing run leaves the tree as it found it. After a passing run, `git status`
// is clean.
//
// This file stays `.mjs` on purpose: Node 22 before 22.18 cannot load `.ts` without a flag,
// and this script must run on every Node in the CI matrix.

import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const cli = join(root, "packages/compiler/dist/cli.mjs")
const examplesDir = join(root, "examples")

/**
 * Every file under `dir` (node_modules skipped), keyed by its relative path. `*.gen.ts`
 * files carry their content; other files carry null, since only the generated files are
 * compared byte for byte.
 */
function snapshot(dir) {
  const files = new Map()
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(path)
      } else if (entry.isFile()) {
        const content = entry.name.endsWith(".gen.ts") ? readFileSync(path, "utf8") : null
        files.set(relative(dir, path), content)
      }
    }
  }
  walk(dir)
  return files
}

function examples() {
  return readdirSync(examplesDir)
    .sort()
    .map((name) => join(examplesDir, name))
    .filter((dir) => statSync(join(dir, "src"), { throwIfNoEntry: false })?.isDirectory())
}

function main() {
  if (!statSync(cli, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${relative(root, cli)} is missing. Run \`bun run build\` first.`)
  }
  console.log(`node ${process.version}`)
  const failures = []
  for (const dir of examples()) {
    const name = relative(examplesDir, dir)
    const before = snapshot(dir)
    const run = spawnSync(process.execPath, [cli, "gen", "--root", dir], { encoding: "utf8" })
    if (run.status !== 0) {
      failures.push(`${name}: gen exited ${run.status}\n${run.stdout}${run.stderr}`)
      continue
    }
    const after = snapshot(dir)
    const problems = []
    for (const path of after.keys()) {
      if (!before.has(path)) problems.push(`created ${path}`)
      if (path.endsWith(".tskm-query.ts")) problems.push(`left a query document ${path}`)
    }
    for (const path of before.keys()) {
      if (!after.has(path)) problems.push(`removed ${path}`)
    }
    for (const [path, previous] of before) {
      if (previous === null || !after.has(path)) continue
      if (after.get(path) !== previous) {
        problems.push(`${path} differs from its content before the run`)
        writeFileSync(join(dir, path), previous)
      }
    }
    if (problems.length > 0) {
      failures.push(`${name}:\n  ${problems.join("\n  ")}`)
      continue
    }
    const generatedCount = [...before.keys()].filter((path) => path.endsWith(".gen.ts")).length
    console.log(`ok ${name}: ${generatedCount} generated files byte-identical`)
  }
  if (failures.length > 0) {
    console.error(`node smoke failed:\n${failures.join("\n")}`)
    process.exitCode = 1
  }
}

main()
