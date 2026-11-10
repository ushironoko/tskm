import { spawnSync } from "node:child_process"
import { resolveTsgoExecutable } from "../packages/compiler/src/tsgo-client.ts"

const executable = resolveTsgoExecutable()
const child = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" })
if (child.error) {
  console.error(`tskm: could not run ${executable}: ${child.error.message}`)
}
process.exit(child.status ?? 1)
