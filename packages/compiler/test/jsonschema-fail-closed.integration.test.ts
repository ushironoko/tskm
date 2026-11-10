import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { generateJsonSchema } from "../src/index.ts"

// The real isolated worker, run under Bun, for the two fail-closed rules that are not
// about one type: non-finite numbers (`nonfinite`) and the previous output of a failing
// source (deleted, or kept with a warning when the module will not load).

function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

const nonfiniteRoot = fileURLToPath(new URL("./fixtures/json-nonfinite", import.meta.url))
const nonfiniteSource = join(nonfiniteRoot, "src/limits.schema.ts")
const nonfiniteOutput = join(nonfiniteRoot, "src/limits.schema.json")

const staleRoot = fileURLToPath(new URL("./fixtures/json-stale", import.meta.url))
const srcDir = join(staleRoot, "src")
const orderSource = join(srcDir, "order.schema.ts")
const orderOutput = join(srcDir, "order.schema.json")

const GOOD_ORDER = `import { object, string } from "@tskm/core"\nexport const orderSchema = object({ id: string() })\n`
const BAD_ORDER = `import { bigint, object } from "@tskm/core"\nexport const orderSchema = object({ amount: bigint() })\n`

function writeSource(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, text)
}

afterAll(() => {
  for (const file of [nonfiniteOutput, orderOutput]) {
    if (existsSync(file)) rmSync(file)
  }
  rmSync(srcDir, { recursive: true, force: true })
})

describe.skipIf(!bun)("generateJsonSchema — non-finite numbers (real worker)", () => {
  const prefix = `tskm: ${nonfiniteSource}: `

  it("refuses literal(Infinity), a NaN picklist option, and a -Infinity bound by default", async () => {
    rmSync(nonfiniteOutput, { force: true })
    const result = await generateJsonSchema({
      root: nonfiniteRoot,
      config: { include: ["src/limits.schema.ts"] },
      execPath: bun,
      timeoutMs: 30_000,
    })

    expect(result.files).toEqual([])
    expect(existsSync(nonfiniteOutput)).toBe(false)
    expect(result.errors).toEqual([
      `${prefix}limitsSchema.cap: cannot convert schema type "literal" to JSON Schema: Infinity has no JSON representation. Add "nonfinite" to jsonSchema.approximate (CLI: --approximate nonfinite) to emit it as a schema no JSON value matches instead.`,
      `${prefix}limitsSchema.code: cannot convert schema type "picklist" to JSON Schema: option NaN has no JSON representation. Add "nonfinite" to jsonSchema.approximate (CLI: --approximate nonfinite) to emit it by dropping the option NaN instead.`,
      `${prefix}limitsSchema.floor: cannot convert pipe item "min_value" to JSON Schema: -Infinity has no JSON representation. Add "nonfinite" to jsonSchema.approximate (CLI: --approximate nonfinite) to emit it by omitting minimum instead.`,
    ])
  }, 60_000)

  it("with nonfinite listed, writes the approximation for each position and warns once per use", async () => {
    rmSync(nonfiniteOutput, { force: true })
    const result = await generateJsonSchema({
      root: nonfiniteRoot,
      config: { include: ["src/limits.schema.ts"], jsonSchema: { approximate: ["nonfinite"] } },
      execPath: bun,
      timeoutMs: 30_000,
    })

    expect(result.errors).toEqual([])
    expect(result.files).toHaveLength(1)
    expect(result.diagnostics).toEqual([
      `${prefix}limitsSchema.cap: approximated nonfinite as a schema no JSON value matches.`,
      `${prefix}limitsSchema.code: approximated nonfinite by dropping the option NaN.`,
      `${prefix}limitsSchema.floor: approximated nonfinite by omitting minimum.`,
    ])
    const doc = JSON.parse(readFileSync(nonfiniteOutput, "utf8")) as {
      limitsSchema: { properties: Record<string, unknown> }
    }
    expect(doc.limitsSchema.properties).toEqual({
      cap: { not: {} },
      code: { enum: [1] },
      floor: { type: "number" },
    })
  }, 60_000)
})

describe.skipIf(!bun)(
  "generateJsonSchema — the previous output of a failing source (real worker)",
  () => {
    beforeEach(() => {
      rmSync(srcDir, { recursive: true, force: true })
      mkdirSync(srcDir, { recursive: true })
    })

    const include = ["src/order.schema.ts"]
    const run = () =>
      generateJsonSchema({ root: staleRoot, config: { include }, execPath: bun, timeoutMs: 30_000 })

    it("deletes the previous output when the source now has an unrepresentable type", async () => {
      writeSource(orderSource, GOOD_ORDER)
      const first = await run()
      expect(first.errors).toEqual([])
      expect(first.files.map((file) => file.output)).toEqual([orderOutput])
      expect(existsSync(orderOutput)).toBe(true)

      writeSource(orderSource, BAD_ORDER)
      const second = await run()
      expect(second.files).toEqual([])
      expect(second.errors).toHaveLength(1)
      expect(second.removed).toEqual([orderOutput])
      // The stale document is gone, so no consumer can read it.
      expect(existsSync(orderOutput)).toBe(false)
    }, 60_000)

    it("keeps the previous output, with a warning, when the module will not load", async () => {
      writeSource(orderSource, GOOD_ORDER)
      await run()
      const before = readFileSync(orderOutput, "utf8")

      // A module that does not parse: the worker fails, so the schemas are unknown.
      writeSource(orderSource, "export const orderSchema = {\n")
      const result = await run()

      // The exit code does not change for a module that did not load (see the warning).
      expect(result.errors).toEqual([])
      expect(result.removed).toEqual([])
      expect(readFileSync(orderOutput, "utf8")).toBe(before)
      expect(
        result.diagnostics.some((line) =>
          line.startsWith(
            `tskm: ${orderOutput}: may be out of date: ${orderSource} could not be loaded`,
          ),
        ),
      ).toBe(true)
    }, 60_000)

    it("never touches a file that has no schema exports, even when it has a same-named json file", async () => {
      // `helper.ts` is not a schema module, and `helper.json` is hand-written: it must survive.
      const helperSource = join(srcDir, "helper.ts")
      const helperJson = join(srcDir, "helper.json")
      writeSource(helperSource, "export const answer = 42\n")
      writeFileSync(helperJson, '{"hand":"written"}\n')

      const result = await generateJsonSchema({
        root: staleRoot,
        config: { include: ["src/helper.ts"] },
        execPath: bun,
        timeoutMs: 30_000,
      })

      expect(result.files).toEqual([])
      expect(result.removed).toEqual([])
      expect(readFileSync(helperJson, "utf8")).toBe('{"hand":"written"}\n')
    }, 60_000)

    it("deletes the previous output when every export is excluded from the allow-list", async () => {
      const zodSource = join(srcDir, "zorder.schema.ts")
      const zodOutput = join(srcDir, "zorder.schema.json")
      writeSource(
        zodSource,
        `import { z } from "zod"\nexport const zodOrder = z.object({ id: z.string() })\n`,
      )

      const allowed = await generateJsonSchema({
        root: staleRoot,
        config: { include: ["src/zorder.schema.ts"] },
        execPath: bun,
        timeoutMs: 30_000,
      })
      expect(allowed.files).toHaveLength(1)
      expect(existsSync(zodOutput)).toBe(true)

      const excluded = await generateJsonSchema({
        root: staleRoot,
        config: { include: ["src/zorder.schema.ts"], schemaSources: [] },
        execPath: bun,
        timeoutMs: 30_000,
      })
      expect(excluded.errors).toEqual([])
      expect(excluded.files).toEqual([])
      expect(excluded.removed).toEqual([zodOutput])
      expect(existsSync(zodOutput)).toBe(false)
    }, 60_000)

    it("does not delete a file that another source wrote in the same run (outDir flattens basenames)", async () => {
      // Both sources flatten to `out/order.schema.json`. The first writes it, and the second, which
      // fails, must not delete what the first just wrote.
      mkdirSync(join(srcDir, "a"), { recursive: true })
      mkdirSync(join(srcDir, "b"), { recursive: true })
      writeSource(join(srcDir, "a", "order.schema.ts"), GOOD_ORDER)
      writeSource(join(srcDir, "b", "order.schema.ts"), BAD_ORDER)
      const flattened = join(staleRoot, "out", "order.schema.json")
      try {
        const result = await generateJsonSchema({
          root: staleRoot,
          config: { include: ["src/**/order.schema.ts"], jsonSchema: { outDir: "out" } },
          execPath: bun,
          timeoutMs: 30_000,
        })
        expect(result.files.map((file) => file.source).sort()).toEqual([
          join(srcDir, "a", "order.schema.ts"),
        ])
        expect(result.errors).toHaveLength(1)
        expect(result.removed).toEqual([])
        expect(existsSync(flattened)).toBe(true)
      } finally {
        rmSync(join(staleRoot, "out"), { recursive: true, force: true })
      }
    }, 60_000)
  },
)
