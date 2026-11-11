import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveConfig, type TskmConfig } from "../src/config.ts"
import { createSession, type TskmSession } from "../src/session.ts"
import { describe, expect, it } from "./test-api.ts"
import { withTestTsgo } from "./tsgo-test-executable.ts"

// session.isCurrent is the content check watch() uses in place of trusting file-system events.
// It must follow the text the last pass generated from (for inplace, the text that pass wrote),
// so these cases pin that contract against the real checker.

const tskmCore = fileURLToPath(new URL("../../tskm/src/index.ts", import.meta.url))

const sidecarSchema = `import { object, string, number } from "@tskm/core"

export const aSchema = object({ id: string(), size: number() })
`

const inplaceSchema = `import { object, string, number, type Infer } from "@tskm/core"

export const aSchema = object({ id: string(), size: number() })

export type A = Infer<typeof aSchema>
`

const noSchema = "export const x = 1\n"

interface Project {
  readonly root: string
  readonly source: string
  readonly config: TskmConfig
}

function makeProject(mode: "sidecar" | "inplace", initial: string): Project {
  const root = mkdtempSync(join(tmpdir(), "tskm-current-"))
  mkdirSync(join(root, "src"))
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
        paths: { "@tskm/core": [tskmCore] },
      },
      include: ["src"],
    })}\n`,
  )
  const source = join(root, "src", "a.schema.ts")
  writeFileSync(source, initial)
  const config = withTestTsgo({
    mode,
    include: ["src/*.schema.ts"],
    tsconfig: "tsconfig.json",
  })
  return { root, source, config }
}

function openSession(project: Project): TskmSession {
  return createSession(resolveConfig(project.config, project.root))
}

describe("session.isCurrent — tracks the content the last pass generated from", () => {
  it("is false before a pass, true after it, and false again once the content changes", () => {
    const project = makeProject("sidecar", sidecarSchema)
    const session = openSession(project)
    try {
      expect(session.isCurrent(project.source)).toBe(false)

      session.generateFile(project.source)
      expect(session.isCurrent(project.source)).toBe(true)

      writeFileSync(project.source, sidecarSchema.replace("size", "count"))
      expect(session.isCurrent(project.source)).toBe(false)

      session.generateFile(project.source)
      expect(session.isCurrent(project.source)).toBe(true)
    } finally {
      session.close()
      rmSync(project.root, { recursive: true, force: true })
    }
  })

  it("treats identical bytes as current: a rewrite is not a change", () => {
    const project = makeProject("sidecar", sidecarSchema)
    const session = openSession(project)
    try {
      session.generateFile(project.source)
      writeFileSync(project.source, sidecarSchema)
      expect(session.isCurrent(project.source)).toBe(true)
    } finally {
      session.close()
      rmSync(project.root, { recursive: true, force: true })
    }
  })

  it("holds for a source with no targets after a pass, and clears once it gains one", () => {
    const project = makeProject("sidecar", noSchema)
    const session = openSession(project)
    try {
      expect(session.generateFile(project.source).file).toBeNull()
      expect(session.isCurrent(project.source)).toBe(true)

      writeFileSync(project.source, sidecarSchema)
      expect(session.isCurrent(project.source)).toBe(false)
    } finally {
      session.close()
      rmSync(project.root, { recursive: true, force: true })
    }
  })

  it("records a source with no targets as current after a full pass too", () => {
    const project = makeProject("sidecar", noSchema)
    const session = openSession(project)
    try {
      expect(session.generateAll().files).toEqual([])
      expect(session.isCurrent(project.source)).toBe(true)

      writeFileSync(project.source, sidecarSchema)
      expect(session.isCurrent(project.source)).toBe(false)
    } finally {
      session.close()
      rmSync(project.root, { recursive: true, force: true })
    }
  })

  it("is true for the text an inplace pass wrote, and false once something else writes", () => {
    const project = makeProject("inplace", inplaceSchema)
    const session = openSession(project)
    try {
      // The pass rewrites the source with the generated region, so the file no longer holds
      // `inplaceSchema`. Currency must follow what was written.
      const result = session.generateFile(project.source)
      expect(result.file?.changed).toBe(true)
      expect(session.isCurrent(project.source)).toBe(true)

      writeFileSync(project.source, inplaceSchema)
      expect(session.isCurrent(project.source)).toBe(false)
    } finally {
      session.close()
      rmSync(project.root, { recursive: true, force: true })
    }
  })

  it("is false for a source that was deleted after a pass", () => {
    const project = makeProject("sidecar", sidecarSchema)
    const session = openSession(project)
    try {
      session.generateFile(project.source)
      rmSync(project.source)
      expect(session.isCurrent(project.source)).toBe(false)
    } finally {
      session.close()
      rmSync(project.root, { recursive: true, force: true })
    }
  })

  it("is recomputed by a full pass: a source the pass no longer covers is not current", () => {
    const project = makeProject("sidecar", sidecarSchema)
    const session = openSession(project)
    try {
      session.generateAll()
      expect(session.isCurrent(project.source)).toBe(true)

      rmSync(project.source)
      session.generateAll()
      expect(session.isCurrent(project.source)).toBe(false)

      // Re-creating the identical bytes is a new source as far as the last pass goes, so it
      // must not be treated as current until a pass generates it.
      writeFileSync(project.source, sidecarSchema)
      expect(session.isCurrent(project.source)).toBe(false)
    } finally {
      session.close()
      rmSync(project.root, { recursive: true, force: true })
    }
  })
})
