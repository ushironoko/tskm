import { dlopen, FFIType } from "bun:ffi"
import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { newPipeFds, pipeIdentities, selectFdTable } from "../src/bun-sync-fds.ts"
import { createTsgoClient, FAILURE_TYPE_FLAGS } from "../src/tsgo-client.ts"
import { isNonBlocking } from "./fd-status.ts"

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
      // Removal must take the document out of the program, not just stop the write:
      // the marker that resolved before must now be a missing type.
      expect(client.resolveTypeAt(query, bad.indexOf("__q"))).toBeNull()
    } finally {
      client.close()
      client.close()
    }
  })

  it("fails closed for a document the project does not include", () => {
    const { root, tsconfig } = project()
    mkdirSync(join(root, "outside"))
    const client = createTsgoClient({ cwd: root, tsconfigPath: tsconfig })
    const outside = join(root, "outside/probe.tskm-query.ts")
    const text = `declare const __q: number = "not a number"\n`
    try {
      client.applyOverlay([{ document: outside, text }])
      // The checker reports "source file not found" for such a document. The client maps
      // that to a missing type, and a diagnostics call to the synthetic failure entry.
      expect(client.resolveTypeAt(outside, text.indexOf("__q"))).toBeNull()
      expect(client.getDiagnostics(outside)).toEqual([{ code: -1, fileName: outside }])
      client.clearOverlay([outside])
    } finally {
      client.close()
    }
  })
})

// Procfs is hidden, so the client finds its checker pipes through `/dev/fd`. That is the
// path macOS takes, so this runs there too.
const FALLBACK_DIRS = { procFdDir: "/tskm-missing-fd-table", devFdDir: "/dev/fd" }

describe("TsgoClient on the /dev/fd fallback", () => {
  it("resolves an in-memory query when the procfs fd table is missing", () => {
    const { root, tsconfig } = project()
    const client = createTsgoClient({ cwd: root, tsconfigPath: tsconfig, fdDirs: FALLBACK_DIRS })
    const query = join(root, "src/fallback.tskm-query.ts")
    const body = `import { user } from "./schema"\ndeclare const __q: typeof user\n`
    try {
      client.applyOverlay([{ document: query, text: body }])
      const resolved = client.resolveTypeAt(query, body.indexOf("__q"))
      expect(resolved?.text).toContain("id: number")
      expect(resolved?.text).toContain("name: string")
      expect(resolved ? resolved.flags & FAILURE_TYPE_FLAGS : -1).toBe(0)
      expect(existsSync(query)).toBe(false)
    } finally {
      client.close()
    }
  })

  // The channel asks for blocking pipes. A non-blocking read would spin on EAGAIN with a
  // 1 ms sleep per retry, so the fallback must actually clear O_NONBLOCK. On macOS this is
  // the check that the variadic-safe fcntl call takes effect.
  it("leaves the checker pipes blocking", () => {
    const { root, tsconfig } = project()
    const table = selectFdTable(FALLBACK_DIRS)
    if (table === undefined) {
      throw new Error("expected the /dev/fd table")
    }
    const before = pipeIdentities(table)
    const client = createTsgoClient({ cwd: root, tsconfigPath: tsconfig, fdDirs: FALLBACK_DIRS })
    try {
      const pipes = newPipeFds(before, pipeIdentities(table))
      expect(pipes.length).toBe(2)
      for (const fd of pipes) {
        expect(isNonBlocking(fd)).toBe(false)
      }
    } finally {
      client.close()
    }
  })

  // The fallback never calls fcntl, so the checker's pipes keep whatever mode Bun gave
  // them. Force O_NONBLOCK on both pipe ends and check that the channel's EAGAIN retry
  // still returns every answer, and that the flag survives the queries.
  it.skipIf(process.platform !== "linux")(
    "keeps resolving when the checker pipes are non-blocking",
    () => {
      const F_GETFL = 3
      const F_SETFL = 4
      const O_NONBLOCK = 0o4000
      const libc = dlopen("libc.so.6", {
        fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
      })
      const { root, tsconfig } = project()
      const table = selectFdTable(FALLBACK_DIRS)
      if (table === undefined) {
        throw new Error("expected the /dev/fd table")
      }
      const before = pipeIdentities(table)
      const client = createTsgoClient({ cwd: root, tsconfigPath: tsconfig, fdDirs: FALLBACK_DIRS })
      try {
        const pipes = newPipeFds(before, pipeIdentities(table))
        expect(pipes.length).toBe(2)
        for (const fd of pipes) {
          libc.symbols.fcntl(fd, F_SETFL, libc.symbols.fcntl(fd, F_GETFL, 0) | O_NONBLOCK)
        }
        const body = `import { user } from "./schema"\ndeclare const __q: typeof user\n`
        for (let round = 0; round < 5; round++) {
          const query = join(root, `src/nonblocking-${round}.tskm-query.ts`)
          client.applyOverlay([{ document: query, text: body }])
          expect(client.resolveTypeAt(query, body.indexOf("__q"))?.text).toContain("id: number")
          client.clearOverlay([query])
        }
        for (const fd of pipes) {
          expect(libc.symbols.fcntl(fd, F_GETFL, 0) & O_NONBLOCK).not.toBe(0)
        }
      } finally {
        client.close()
        libc.close()
      }
    },
  )
})
