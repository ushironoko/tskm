// The compiler integration scenarios under Node, against the built package. The same
// scenarios run under bun:test against the source (the *.integration.test.ts files), so a
// behavior that differs by runtime fails in one of the two runs.
//
// Run `bun run build` first: this imports dist/index.mjs, the artifact that users install.
// Run with `bun run test:integration:node`. The scenarios share fixture paths, so they run
// in order in this one process, never in parallel.
import { existsSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { registerSuite } from "./runners/node.ts"
import { basicSuite, inplaceSuite, nullishSuite, preprocessSuite } from "./scenarios/generate.ts"
import { standardSuites } from "./scenarios/standard.ts"
import type { CompilerApi } from "./scenarios/support.ts"
import { tsgoClientSuite } from "./scenarios/tsgo-client.ts"
import { watchSuites } from "./scenarios/watch.ts"

const dist = fileURLToPath(new URL("../dist/index.mjs", import.meta.url))
if (!existsSync(dist)) {
  throw new Error(`${dist} is missing. Run \`bun run build\` first.`)
}
// Imported at run time: the build output is not a type-checked input of this package.
const compiler = (await import(pathToFileURL(dist).href)) as CompilerApi

for (const suite of [
  tsgoClientSuite(compiler),
  basicSuite(compiler),
  nullishSuite(compiler),
  preprocessSuite(compiler),
  inplaceSuite(compiler),
  ...standardSuites(compiler),
  ...watchSuites(compiler),
]) {
  registerSuite(suite)
}
