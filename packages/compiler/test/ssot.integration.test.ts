// biome-ignore-all lint/suspicious/noTemplateCurlyInString: assertions compare against emitted type text that contains literal "${...}"
import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"
import { runTsgoNoEmit } from "./typecheck-harness.ts"

// End-to-end SSoT proof (meta-issue #24): a single RECURSIVE schema composing a templateLiteral
// id (#18), a faithful-optional `label` (#17), a record keyed by a templateLiteral (#19), and a
// recursive `children` is run through the real generate()+structural-worker+tsgo pipeline. The
// emitted type must mirror InferOutput (faithful `k?:`, templated key, template-literal id), and
// the result must type-check under real tsgo with a value probe. This pins the compiler-emit view
// of the composition that ssot.test.ts pins for the runtime/InferOutput views.
const fixtureRoot = fileURLToPath(new URL("./fixtures/ssot", import.meta.url))
const src = (file: string): string =>
  fileURLToPath(new URL(`./fixtures/ssot/src/${file}`, import.meta.url))
const genFile = src("node.schema.gen.ts")
const probeFile = src("probe.check.ts")

function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

afterAll(() => {
  for (const f of [genFile, probeFile]) {
    if (existsSync(f)) rmSync(f)
  }
})

describe.skipIf(!bun)("SSoT composition emits a faithful type (#24, real worker + tsgo)", () => {
  it("emits the faithful optional, templated id, keyed record, and recursive self-reference", async () => {
    await generate({
      root: fixtureRoot,
      config: {
        mode: "sidecar",
        include: ["src/node.schema.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: bun },
      },
    })
    const gen = readFileSync(genFile, "utf8")
    expect(gen).toContain("export type Node = {")
    // #18: the id is the template-literal type, not widened to `string`.
    expect(gen).toContain("id: `node_${string}`")
    // #17: the optional key is omittable (`label?:`), not `label: string | undefined`.
    expect(gen).toContain("label?: string")
    expect(gen).not.toContain("label: string | undefined")
    // #19: the record key is templated (a mapped type over the template literal), not `string`.
    expect(gen).toContain("K in `attr_${string}`")
    expect(gen).not.toContain("[key: string]: number")
    // recursive self-reference by alias name.
    expect(gen).toContain("children: Node[]")
    // the `Infer` alias on the same binding folds to a thin re-export.
    expect(gen).toContain("export type NodeType = Node")
  }, 120_000)

  it("KEYSTONE: the emitted type type-checks under real tsgo with a value probe", () => {
    writeFileSync(
      probeFile,
      `import type { Node, NodeType } from "./node.schema.gen.ts"

// label is omittable (faithful optional); id is templated; attrs keys are templated.
const leaf: Node = { id: "node_a", attrs: { attr_x: 1 }, children: [] }
const root: NodeType = { id: "node_root", label: "r", attrs: {}, children: [leaf] }
export const probes = [leaf, root] as const
`,
    )
    const check = runTsgoNoEmit(fixtureRoot)
    expect(check.output).not.toContain("error TS")
    expect(check.ok).toBe(true)
  }, 120_000)
})
