import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTsgoClient, FAILURE_TYPE_FLAGS } from "../src/tsgo-client.ts"

const roots: string[] = []

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
})

function project(): { root: string; tsconfig: string } {
  const root = mkdtempSync(join(tmpdir(), "tskm-sync-"))
  roots.push(root)
  mkdirSync(join(root, "src"))
  const tsconfig = join(root, "tsconfig.json")
  writeFileSync(
    tsconfig,
    `${JSON.stringify({
      compilerOptions: {
        target: "es2022",
        module: "esnext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    })}\n`,
  )
  writeFileSync(
    join(root, "src/schema.ts"),
    `export const user = { id: 1 as number, name: "x" as string }\n`,
  )
  return { root, tsconfig }
}

describe("TsgoClient (typescript/sync)", () => {
  it("resolves an in-memory query without writing it, and fails closed on any/unknown/never", () => {
    // Importing child_process above locks spawn the way Vite does. The shim
    // still has to attach pipe fds. Touch the import so it cannot be dropped.
    expect(typeof spawnSync).toBe("function")
    const { root, tsconfig } = project()
    const client = createTsgoClient({ cwd: root, tsconfigPath: tsconfig })
    const query = join(root, "src/schema.tskm-query.ts")
    try {
      expect(client.supportsOverlay).toBe(true)

      const body = `import { user } from "./schema"\ndeclare const __q: typeof user\n`
      client.applyOverlay([{ document: query, text: body }])
      expect(existsSync(query)).toBe(false)
      const resolved = client.resolveTypeAt(query, body.indexOf("__q"))
      if (!resolved) {
        throw new Error("expected a resolved type")
      }
      expect(resolved.text).toContain("id: number")
      expect(resolved.text).toContain("name: string")
      expect(resolved.flags & FAILURE_TYPE_FLAGS).toBe(0)

      for (const kind of ["any", "unknown", "never"] as const) {
        const text = `declare const __q: ${kind}\n`
        client.applyOverlay([{ document: query, text }])
        const failed = client.resolveTypeAt(query, text.indexOf("__q"))
        if (!failed) {
          throw new Error(`expected a ${kind} type`)
        }
        expect(failed.text).toBe(kind)
        expect(failed.flags & FAILURE_TYPE_FLAGS).not.toBe(0)
        expect(existsSync(query)).toBe(false)
      }

      const bad = `declare const __q: NotAType\n`
      client.applyOverlay([{ document: query, text: bad }])
      const diagnostics = client.getDiagnostics(query)
      expect(diagnostics.some((d) => d.code === 2304)).toBe(true)
      expect(diagnostics.some((d) => d.text?.includes("Cannot find name 'NotAType'"))).toBe(true)
      expect(existsSync(query)).toBe(false)

      client.clearOverlay([query])
      expect(existsSync(query)).toBe(false)
      expect(client.resolveTypeAt(query, 0)).toBeNull()
    } finally {
      client.close()
      client.close()
    }
  })
})
