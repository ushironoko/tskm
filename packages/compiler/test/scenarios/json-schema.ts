import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CompilerApi, Scenario, Suite } from "./support.ts"

// The JSON Schema emitter's fail-closed rules, as shared scenarios. The same assertions run
// under Bun against the source (`src/index.ts`) and under Node against the built artifact
// (`dist/index.mjs`). Each scenario writes a scratch project inside `test/fixtures`, so zod and
// valibot resolve from this repo's node_modules, as they do for a user's project.
//
// The scratch project gets two ways to reach `@tskm/core`. A tsconfig `paths` entry maps it to
// the source for Bun. A `node_modules/@tskm/core` link maps it to the package for Node, which
// reads `dist` (so the Node run needs `bun run build` first, as node-integration.ts does).

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url))
const TSKM_PACKAGE = fileURLToPath(new URL("../../../tskm/", import.meta.url))
const TSKM_SOURCE = join(TSKM_PACKAGE, "src/index.ts")

/** Writes a scratch project (tsconfig, the `@tskm/core` link, and `files`) and returns its root. */
function makeProject(dirs: string[], files: Record<string, string>): string {
  const dir = mkdtempSync(join(FIXTURES, ".json-scratch-"))
  dirs.push(dir)
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        baseUrl: ".",
        paths: { "@tskm/core": [TSKM_SOURCE] },
      },
      include: ["src"],
    }),
  )
  mkdirSync(join(dir, "node_modules", "@tskm"), { recursive: true })
  symlinkSync(TSKM_PACKAGE, join(dir, "node_modules", "@tskm", "core"), "dir")
  writeProjectFiles(dir, files)
  return dir
}

function writeProjectFiles(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
}

/** A project-local valibot converter whose output is recognizable (the project's own copy). */
const PROJECT_VALIBOT_CONVERTER: Record<string, string> = {
  "node_modules/@valibot/to-json-schema/package.json": JSON.stringify({
    name: "@valibot/to-json-schema",
    version: "0.0.0-scratch",
    main: "index.cjs",
  }),
  "node_modules/@valibot/to-json-schema/index.cjs":
    "exports.toJsonSchema = () => ({ 'x-project-copy': true })\n",
}

const GOOD_ORDER = `import { object, string } from "@tskm/core"\nexport const orderSchema = object({ id: string() })\n`
const BAD_ORDER = `import { bigint, object } from "@tskm/core"\nexport const orderSchema = object({ amount: bigint() })\n`

export function jsonSchemaSuite(api: CompilerApi): Suite {
  const dirs: string[] = []
  const run = (root: string, include: string[], extra: Record<string, unknown> = {}) =>
    api.generateJsonSchema({
      root,
      config: { include, ...extra },
      timeoutMs: 60_000,
    })

  const scenarios: Scenario[] = [
    {
      name: "refuses a non-finite literal by default, and writes it once nonfinite is listed",
      timeout: 120_000,
      run: async () => {
        const root = makeProject(dirs, {
          "src/limits.schema.ts": `import { literal, object } from "@tskm/core"\nexport const limitsSchema = object({ cap: literal(Number.POSITIVE_INFINITY) })\n`,
        })
        const refused = await run(root, ["src/limits.schema.ts"])
        assert.equal(refused.files.length, 0)
        assert.equal(refused.errors.length, 1)
        assert.match(
          refused.errors[0] ?? "",
          /limitsSchema\.cap: .*Infinity has no JSON representation/,
        )
        assert.equal(existsSync(join(root, "src/limits.schema.json")), false)

        const approved = await run(root, ["src/limits.schema.ts"], {
          jsonSchema: { approximate: ["nonfinite"] },
        })
        assert.deepEqual(approved.errors, [])
        const doc = JSON.parse(readFileSync(join(root, "src/limits.schema.json"), "utf8")) as {
          limitsSchema: { properties: Record<string, unknown> }
        }
        assert.deepEqual(doc.limitsSchema.properties, { cap: { not: {} } })
      },
    },
    {
      name: "deletes the previous output when a tskm schema can no longer be represented",
      timeout: 120_000,
      run: async () => {
        const root = makeProject(dirs, { "src/order.schema.ts": GOOD_ORDER })
        const output = join(root, "src/order.schema.json")
        assert.equal((await run(root, ["src/order.schema.ts"])).files.length, 1)
        assert.equal(existsSync(output), true)

        writeProjectFiles(root, { "src/order.schema.ts": BAD_ORDER })
        const failed = await run(root, ["src/order.schema.ts"])
        assert.equal(failed.errors.length, 1)
        assert.deepEqual(failed.removed, [output])
        assert.equal(existsSync(output), false)
      },
    },
    {
      name: "keeps the previous output, with a warning, when the module does not load",
      timeout: 120_000,
      run: async () => {
        const root = makeProject(dirs, { "src/order.schema.ts": GOOD_ORDER })
        const output = join(root, "src/order.schema.json")
        await run(root, ["src/order.schema.ts"])
        const before = readFileSync(output, "utf8")

        writeProjectFiles(root, { "src/order.schema.ts": "export const orderSchema = {\n" })
        const result = await run(root, ["src/order.schema.ts"])
        assert.deepEqual(result.errors, [])
        assert.deepEqual(result.removed, [])
        assert.equal(readFileSync(output, "utf8"), before)
        assert.ok(result.diagnostics.some((line) => line.includes("may be out of date")))
      },
    },
    {
      name: "a zod schema the converter cannot express fails its file and deletes the stale output",
      timeout: 120_000,
      run: async () => {
        const root = makeProject(dirs, {
          "src/zodbad.schema.ts": `import { z } from "zod"\nexport const amountSchema = z.object({ amount: z.bigint() })\n`,
        })
        const output = join(root, "src/zodbad.schema.json")
        writeProjectFiles(root, { "src/zodbad.schema.json": '{"stale":true}\n' })

        const result = await run(root, ["src/zodbad.schema.ts"])
        assert.equal(result.files.length, 0)
        assert.equal(result.errors.length, 1)
        assert.match(
          result.errors[0] ?? "",
          /amountSchema: cannot convert zod schema to JSON Schema/,
        )
        assert.deepEqual(result.removed, [output])
        assert.equal(existsSync(output), false)
      },
    },
    {
      name: "a valibot converter installed in the project is the one that runs",
      timeout: 120_000,
      run: async () => {
        const root = makeProject(dirs, {
          ...PROJECT_VALIBOT_CONVERTER,
          "src/valibot.schema.ts": `import * as v from "valibot"\nexport const picked = v.object({ a: v.string() })\n`,
        })
        const result = await run(root, ["src/valibot.schema.ts"])
        assert.deepEqual(result.errors, [])
        const doc = JSON.parse(
          readFileSync(join(root, "src/valibot.schema.json"), "utf8"),
        ) as Record<string, unknown>
        assert.deepEqual(doc, { picked: { "x-project-copy": true } })
      },
    },
  ]

  return {
    title: "JSON Schema fail-closed rules (shared)",
    teardown: () => {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    },
    scenarios,
  }
}

/**
 * The built CLI under Node (`dist/cli.mjs`), end to end: the exit code, the `removed` line on
 * stdout, and the stale output. Node-only, because it spawns the built CLI.
 */
export function jsonSchemaCliSuite(cli: string): Suite {
  const dirs: string[] = []
  return {
    title: "tskm json-schema CLI under Node (dist)",
    teardown: () => {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    },
    scenarios: [
      {
        name: "exits 0 and writes when the source converts, then exits 1 and deletes the stale output when it fails",
        timeout: 120_000,
        run: () => {
          const root = makeProject(dirs, { "src/order.schema.ts": GOOD_ORDER })
          const output = join(root, "src/order.schema.json")
          const cliRun = () =>
            spawnSync(process.execPath, [cli, "json-schema", "--root", root], { encoding: "utf8" })

          const passed = cliRun()
          assert.equal(passed.status, 0, passed.stderr)
          assert.match(passed.stdout, /tskm: wrote src\/order\.schema\.json \(orderSchema\)/)
          assert.equal(existsSync(output), true)

          writeProjectFiles(root, { "src/order.schema.ts": BAD_ORDER })
          const failed = cliRun()
          assert.equal(failed.status, 1)
          assert.match(failed.stderr, /orderSchema\.amount: cannot convert schema type "bigint"/)
          assert.match(
            failed.stdout,
            /tskm: removed src\/order\.schema\.json: its source produced no document/,
          )
          assert.equal(existsSync(output), false)
        },
      },
    ],
  }
}
