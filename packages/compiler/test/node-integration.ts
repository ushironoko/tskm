// The compiler integration scenarios under Node, against the built package. The same
// scenarios run from the source under bun:test (the *.integration.test.ts files) and under
// Node (`bun run test:node`), so a behavior that differs by runtime or by artifact fails in
// one of the runs.
//
// Run `bun run build` first: this imports dist/index.mjs, the artifact that users install.
// Run with `bun run test:integration:node`. The scenarios share fixture paths, so they run
// in order in this one process, never in parallel.
import { existsSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { registerSuite } from "./runners/suite.ts"
import { basicSuite, inplaceSuite, nullishSuite, preprocessSuite } from "./scenarios/generate.ts"
import { jsonSchemaCliSuite, jsonSchemaSuite } from "./scenarios/json-schema.ts"
import { standardSuites } from "./scenarios/standard.ts"
import type { CompilerApi } from "./scenarios/support.ts"
import { tsgoClientSuite } from "./scenarios/tsgo-client.ts"
import { watchSuites } from "./scenarios/watch.ts"

const dist = fileURLToPath(new URL("../dist/index.mjs", import.meta.url))
const cli = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url))
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
  jsonSchemaSuite(compiler),
  jsonSchemaCliSuite(cli),
]) {
  registerSuite(suite)
}
