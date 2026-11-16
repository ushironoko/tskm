import { dlopen, FFIType } from "bun:ffi"
import { afterAll, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { newPipeFds, pipeIdentities, selectFdTable } from "../src/bun-sync-fds.ts"
import * as compiler from "../src/index.ts"
import { createTsgoClient, FAILURE_TYPE_FLAGS } from "../src/tsgo-client.ts"
import { isNonBlocking } from "./fd-status.ts"
import { registerSuite } from "./runners/suite.ts"
import { makeProject } from "./scenarios/support.ts"
import { tsgoClientSuite } from "./scenarios/tsgo-client.ts"

// The overlay scenarios are shared with the Node run (scenarios/tsgo-client.ts). The
// `/dev/fd` fallback below drives Bun's own pipe-fd shim, so it stays Bun-only.
registerSuite(tsgoClientSuite(compiler))

const roots: string[] = []

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
})

function project(): { root: string; tsconfig: string } {
  const made = makeProject()
  roots.push(made.root)
  return made
}

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

// These drive the real checker through the public client surface to reach the error and
// early-return branches the overlay scenarios never touch. A real subprocess spawns, so each
// test caps its own time so a hung checker fails loudly instead of stalling the run.
describe("TsgoClient construction and update guards", () => {
  it(
    "closes the checker and rethrows the original failure when the tsconfig opens no projects",
    () => {
      // A tsconfig path the checker can load a snapshot for but that resolves to no configured
      // project drives the capability probe's "no projects" throw. The constructor must dispose
      // the just-spawned channel (its inner api.close()) and re-raise that same error, not mask
      // it with a close-time failure.
      const root = mkdtempSync(join(tmpdir(), "tskm-noproj-"))
      roots.push(root)
      const missingConfig = join(root, "does-not-exist.tsconfig.json")
      expect(() =>
        createTsgoClient({ cwd: root, tsconfigPath: missingConfig }),
      ).toThrow(`tskm: tsconfig opened no projects: ${missingConfig}`)
    },
    30_000,
  )

  it(
    "treats updateFiles with no created/changed/deleted paths as a no-op",
    () => {
      const { root, tsconfig } = project()
      const client = createTsgoClient({ cwd: root, tsconfigPath: tsconfig })
      const query = join(root, "src/noop-update.tskm-query.ts")
      const body = `import { user } from "./schema"\ndeclare const __q: typeof user\n`
      try {
        client.applyOverlay([{ document: query, text: body }])
        // Neither form commits a snapshot, so the overlay registered above must still resolve.
        client.updateFiles({})
        client.updateFiles({ created: [], changed: [], deleted: [] })
        expect(client.resolveTypeAt(query, body.indexOf("__q"))?.text).toContain("id: number")
      } finally {
        client.close()
      }
    },
    30_000,
  )

  it(
    "treats clearOverlay for an unregistered document as a no-op",
    () => {
      const { root, tsconfig } = project()
      const client = createTsgoClient({ cwd: root, tsconfigPath: tsconfig })
      const query = join(root, "src/kept.tskm-query.ts")
      const body = `import { user } from "./schema"\ndeclare const __q: typeof user\n`
      try {
        client.applyOverlay([{ document: query, text: body }])
        // Clearing a document that was never registered removes nothing and commits no
        // snapshot, so the real overlay document is untouched and still resolves.
        client.clearOverlay([join(root, "src/never-registered.tskm-query.ts")])
        expect(client.resolveTypeAt(query, body.indexOf("__q"))?.text).toContain("id: number")
      } finally {
        client.close()
      }
    },
    30_000,
  )

  it(
    "rethrows a checker error that is not a missing source file",
    () => {
      const { root, tsconfig } = project()
      const client = createTsgoClient({ cwd: root, tsconfigPath: tsconfig })
      const query = join(root, "src/bad-position.tskm-query.ts")
      const body = `import { user } from "./schema"\ndeclare const __q: typeof user\n`
      try {
        client.applyOverlay([{ document: query, text: body }])
        // A negative position is an invalid request, not a missing document: the "source file
        // not found" guard does not match, so resolveAt must propagate the error rather than
        // swallow it as a null (fail-closed) result.
        let thrown: unknown
        try {
          client.resolveTypeAt(query, -1)
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).not.toContain("source file not found")
        // The valid document still resolves afterward, proving the throw was the query's, not
        // a wrecked session.
        expect(client.resolveTypeAt(query, body.indexOf("__q"))?.text).toContain("id: number")
      } finally {
        client.close()
      }
    },
    30_000,
  )
})
