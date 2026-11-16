import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveConfig, type TskmConfig } from "../src/config.ts"
import { createSession, type TskmSession } from "../src/session.ts"
import { describe, expect, it } from "./test-api.ts"
import { withTestTsgo } from "./tsgo-test-executable.ts"

// Edge branches of the batched registration/resolution lifecycle in session.ts that the
// happy-path session tests do not reach: the inplace/standard JSON-schema notice, a static
// worker that cannot load the module, a static warning and a non-identifier static export,
// a stale sentinel region for a removed schema, and the external-schema compile gate's leak
// hint. Each drives the public session API against the real checker.

const tskmCore = fileURLToPath(new URL("../../tskm/src/index.ts", import.meta.url))
const tskmPkg = fileURLToPath(new URL("../../tskm", import.meta.url))

interface EdgeProject {
  readonly root: string
  readonly source: string
  readonly config: TskmConfig
}

function makeEdgeProject(opts: {
  mode: "sidecar" | "inplace"
  file: string
  content: string
  jsonSchema?: TskmConfig["jsonSchema"]
}): EdgeProject {
  const root = mkdtempSync(join(tmpdir(), "tskm-edge-"))
  mkdirSync(join(root, "src"))
  // A node_modules symlink so the isolated worker's runtime `import "@tskm/core"` resolves
  // from the temp root the same way the checker resolves it through tsconfig `paths`.
  mkdirSync(join(root, "node_modules", "@tskm"), { recursive: true })
  try {
    symlinkSync(tskmPkg, join(root, "node_modules", "@tskm", "core"), "dir")
  } catch {
    // tsconfig paths are the primary resolution route; the symlink is only a fallback.
  }
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        baseUrl: ".",
        paths: { "@tskm/core": [tskmCore] },
      },
      include: ["src"],
    })}\n`,
  )
  const source = join(root, "src", opts.file)
  writeFileSync(source, opts.content)
  const config = withTestTsgo({
    mode: opts.mode,
    include: [`src/${opts.file}`],
    tsconfig: "tsconfig.json",
    worker: { execPath: process.execPath },
    ...(opts.jsonSchema ? { jsonSchema: opts.jsonSchema } : {}),
  })
  return { root, source, config }
}

function openSession(project: EdgeProject): TskmSession {
  return createSession(resolveConfig(project.config, project.root))
}

function withSession(project: EdgeProject, body: (session: TskmSession) => void): void {
  const session = openSession(project)
  try {
    body(session)
  } finally {
    session.close()
    rmSync(project.root, { recursive: true, force: true })
  }
}

describe("session edge cases — static JSON Schema in sidecar generation", () => {
  it("reports that inplace mode does not write the standard JSON literals", () => {
    const project = makeEdgeProject({
      mode: "inplace",
      file: "a.schema.ts",
      content: `import { object, string, number, type Infer } from "@tskm/core"

export const aSchema = object({ id: string(), size: number() })

export type A = Infer<typeof aSchema>
`,
      jsonSchema: { emit: "standard" },
    })
    withSession(project, (session) => {
      const result = session.generateFile(project.source)
      // The inplace pass still rewrites the type, but the standard-JSON request is a no-op
      // there, and the user is told so rather than silently getting no literals.
      expect(result.file?.mode).toBe("inplace")
      expect(result.diagnostics.some((d) => d.includes("inplace mode does not emit them"))).toBe(
        true,
      )
    })
  }, 60_000)

  it("surfaces a static-JSON diagnostic (and fails closed) when the module cannot be loaded", () => {
    const project = makeEdgeProject({
      mode: "sidecar",
      file: "boom.schema.ts",
      // Type-checks fine (so the sidecar still resolves), but the isolated worker's
      // runtime import throws, so collectStaticJsonSchemaForFile returns a diagnostic.
      content: `import { object, string } from "@tskm/core"

export const boomSchema = object({ id: string() })

throw new Error("boom at import time")
`,
      jsonSchema: { emit: "standard" },
    })
    withSession(project, (session) => {
      const result = session.generateFile(project.source)
      // The type still emits (static JSON is a separate guarantee), but the load failure is
      // both a diagnostic and an error (so `tskm gen` exits non-zero).
      expect(result.file?.mode).toBe("sidecar")
      expect(result.diagnostics.some((d) => d.includes("skipped"))).toBe(true)
      expect(result.errors?.some((d) => d.includes("skipped"))).toBe(true)
    })
  }, 60_000)

  it("keeps a static export whose documents only approximate, surfacing the approximation warning", () => {
    const project = makeEdgeProject({
      mode: "sidecar",
      file: "warn.schema.ts",
      content: `import { object, string, pipe, transform } from "@tskm/core"

export const warnSchema = object({
  size: pipe(string(), transform((s) => s.length)),
})
`,
      jsonSchema: { emit: "standard", approximate: ["transform"] },
    })
    withSession(project, (session) => {
      const result = session.generateFile(project.source)
      expect(result.file?.mode).toBe("sidecar")
      // The transform output is approximated, which is a warning (the cell is still emitted),
      // not an error, so no `errors` and the schema is written.
      expect(result.diagnostics.some((d) => d.includes("approximated transform"))).toBe(true)
      expect(result.errors).toBeUndefined()
    })
  }, 60_000)

  it("reports a static export whose type has no JSON Schema representation", () => {
    const project = makeEdgeProject({
      mode: "sidecar",
      file: "big.schema.ts",
      content: `import { bigint } from "@tskm/core"

export const amountSchema = bigint()
`,
      jsonSchema: { emit: "standard" },
    })
    withSession(project, (session) => {
      const result = session.generateFile(project.source)
      // The type still emits, but its static document fails closed: bigint has no JSON form.
      expect(result.file?.mode).toBe("sidecar")
      expect(result.errors?.some((d) => d.includes("bigint"))).toBe(true)
      expect(result.diagnostics.some((d) => d.includes("bigint"))).toBe(true)
    })
  }, 60_000)

  it("refuses to emit a static document for an export whose name is not an identifier", () => {
    const project = makeEdgeProject({
      mode: "sidecar",
      file: "weird.schema.ts",
      content: `import { object, string } from "@tskm/core"

export const okSchema = object({ id: string() })

const hiddenSchema = object({ id: string() })
export { hiddenSchema as "weird-name" }
`,
      jsonSchema: { emit: "standard" },
    })
    withSession(project, (session) => {
      const result = session.generateFile(project.source)
      // The normal export is still written; only the string-named one is refused, and it
      // reports exactly why.
      expect(result.file?.mode).toBe("sidecar")
      expect(
        result.diagnostics.some((d) => d.includes("weird-name") && d.includes("not an identifier")),
      ).toBe(true)
      expect(result.errors?.some((d) => d.includes("weird-name"))).toBe(true)
    })
  }, 60_000)
})

describe("session edge cases — inplace stale sentinel regions", () => {
  it("does not crash on a sentinel region whose source schema no longer exists", () => {
    const project = makeEdgeProject({
      mode: "inplace",
      file: "stale.schema.ts",
      // `Ghost` has an emitted sentinel region but no `ghostSchema` declaration: its name is
      // absent from discovery, so the session leaves its placeholder capability as-is while
      // the live `A` schema still regenerates.
      content: `import { object, string, type Infer } from "@tskm/core"

export const aSchema = object({ id: string() })

export type A = Infer<typeof aSchema>

// @tskm-gen Ghost from ghostSchema #00000000
export type Ghost = { old: string }
// @tskm-end Ghost
`,
    })
    withSession(project, (session) => {
      const result = session.generateFile(project.source)
      expect(result.file?.mode).toBe("inplace")
      // The live schema is still emitted despite the orphaned region.
      expect(result.file?.typeNames).toContain("A")
    })
  }, 60_000)
})

describe("session edge cases — external-schema compile gate", () => {
  const stdRoot = fileURLToPath(new URL("./fixtures/standard", import.meta.url))
  const leakSource = join(stdRoot, "src", "zod-leak.schema.ts")
  const leakGen = join(stdRoot, "src", "zod-leak.schema.gen.ts")
  const leakVerify = join(stdRoot, "src", "zod-leak.schema.verify.tskm-query.ts")

  it("names the unimportable leak in the do-not-compile diagnostic", () => {
    const config = withTestTsgo({
      mode: "sidecar",
      include: ["src/zod-leak.schema.ts"],
      tsconfig: "tsconfig.json",
    })
    const session = createSession(resolveConfig(config, stdRoot))
    try {
      const result = session.generateFile(leakSource)
      const joined = result.diagnostics.join("\n")
      expect(result.file).toBeNull()
      expect(joined).toContain("do not compile")
      expect(joined).toContain("LocalThing")
      // The vendor-leak hint only fires when a leaked name is unresolved AND a vendor schema
      // is in the result — session.ts's `leakHint` branch.
      expect(joined).toContain("references names the generated file cannot import")
    } finally {
      session.close()
      for (const file of [leakGen, leakVerify]) {
        rmSync(file, { force: true })
      }
    }
  }, 60_000)
})
