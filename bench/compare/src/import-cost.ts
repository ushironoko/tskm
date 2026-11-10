import { libraries } from "./config.ts"
import { measureImportOnly, type TypeRow } from "./types-count.ts"

// Import cost: each library's imports with no schema copies, under the harness settings (the
// built tskm dist is imported and skipLibCheck is on). Every 100-copy fixture contains the same
// imports, so a zero here means the Type instantiations rows need no adjustment.
// Build the tskm dist first: `bun run --cwd ../../packages/tskm build`.

const rows: TypeRow[] = []
for (const name of libraries) {
  console.log(`imports only: ${name}`)
  rows.push(...measureImportOnly(name))
}

const count = (value: number) => value.toLocaleString("en-US")
console.log("")
console.log("| library | tsc instantiations | tsgo instantiations |")
console.log("| --- | ---: | ---: |")
for (const name of libraries) {
  const tsc = rows.find((row) => row.library === name && row.checker === "tsc")
  const tsgo = rows.find((row) => row.library === name && row.checker === "tsgo")
  if (!tsc || !tsgo) throw new Error(`missing import-only counts for ${name}`)
  console.log(`| ${name} | ${count(tsc.instantiations)} | ${count(tsgo.instantiations)} |`)
}

const nonZero = rows.filter((row) => row.instantiations !== 0)
if (nonZero.length > 0) {
  const list = nonZero.map((row) => `${row.library} ${row.checker} ${row.instantiations}`)
  console.error(`import-only fixtures register instantiations: ${list.join(", ")}`)
  process.exitCode = 1
}
