import { describe, expect, it } from "bun:test"
import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_FD_DIRS,
  type FdDirs,
  newPipeFds,
  pipeIdentities,
  selectFdTable,
  withBunSyncChannelFds,
} from "../src/bun-sync-fds.ts"
import { isNonBlocking } from "./fd-status.ts"

const isBun = process.versions.bun !== undefined
const isBunPosix = isBun && process.platform !== "win32"
const isPosix = process.platform !== "win32"
// A directory that does not exist, standing in for a platform without procfs.
const NO_TABLE = "/tskm-missing-fd-table"
// Procfs is missing, so the shim must use `/dev/fd`, which macOS provides.
const FALLBACK = { procFdDir: NO_TABLE, devFdDir: "/dev/fd" }
// Identity formats: procfs reports link text (`pipe:[123]`); `/dev/fd` reports `dev:ino`.
const LINK_TEXT = /^(socket|pipe):\[\d+\]$/
const DEV_INO = /^\d+:\d+$/

const childProcessPrototype = (): { spawn: unknown } =>
  (
    process.getBuiltinModule("node:child_process") as unknown as {
      ChildProcess: { prototype: { spawn: unknown } }
    }
  ).ChildProcess.prototype

async function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  await new Promise<void>((resolve) => child.once("exit", () => resolve()))
}

describe("selectFdTable", () => {
  it.skipIf(!isBunPosix)("prefers procfs when it exists", async () => {
    const pipes = await shimPipes(DEFAULT_FD_DIRS)
    try {
      const table = selectFdTable(DEFAULT_FD_DIRS)
      expect(table).toBeDefined()
      const identities = pipeIdentities(table as NonNullable<typeof table>)
      // On Linux the default is procfs, so identity is the link text. Elsewhere it is /dev/fd.
      const expected = existsSync(DEFAULT_FD_DIRS.procFdDir) ? LINK_TEXT : DEV_INO
      for (const fd of pipes.fds) {
        expect(identities.get(fd)).toMatch(expected)
      }
    } finally {
      await pipes.stop()
    }
  })

  it.skipIf(!isBunPosix)("falls back to /dev/fd when procfs is missing", async () => {
    const pipes = await shimPipes(FALLBACK)
    try {
      const table = selectFdTable(FALLBACK)
      expect(table).toBeDefined()
      const identities = pipeIdentities(table as NonNullable<typeof table>)
      for (const fd of pipes.fds) {
        expect(identities.get(fd)).toMatch(DEV_INO)
      }
    } finally {
      await pipes.stop()
    }
  })

  it("returns undefined when neither table exists", () => {
    expect(selectFdTable({ procFdDir: NO_TABLE, devFdDir: `${NO_TABLE}-dev` })).toBeUndefined()
  })
})

describe("fd identities", () => {
  it.skipIf(!isPosix)("reports a FIFO as a pipe and a regular file as nothing", () => {
    const table = selectFdTable(FALLBACK)
    if (table === undefined) {
      throw new Error("expected the /dev/fd table")
    }
    const fifo = fifoFd()
    const file = regularFileFd()
    try {
      const identities = pipeIdentities(table)
      expect(identities.get(fifo)).toMatch(DEV_INO)
      expect(identities.has(file)).toBe(false)
    } finally {
      closeSync(fifo)
      closeSync(file)
    }
  })

  it.skipIf(!isPosix)("drops a descriptor once it is closed", () => {
    const table = selectFdTable(FALLBACK)
    if (table === undefined) {
      throw new Error("expected the /dev/fd table")
    }
    const fifo = fifoFd()
    expect(pipeIdentities(table).has(fifo)).toBe(true)
    closeSync(fifo)
    expect(pipeIdentities(table).has(fifo)).toBe(false)
  })
})

describe("newPipeFds", () => {
  it("reports new descriptors and descriptors whose identity changed, in order", () => {
    const before = new Map([
      [3, "socket:[1]"],
      [4, "socket:[2]"],
    ])
    const after = new Map([
      [3, "socket:[1]"],
      // Fd 4 was closed and reused by a new socket: same number, new identity.
      [4, "socket:[9]"],
      [7, "pipe:[5]"],
      [6, "socket:[8]"],
    ])
    expect(newPipeFds(before, after)).toEqual([4, 6, 7])
  })

  it("ignores descriptors that closed during the spawn", () => {
    expect(newPipeFds(new Map([[5, "socket:[3]"]]), new Map())).toEqual([])
  })
})

describe("withBunSyncChannelFds", () => {
  it("returns the callback result and leaves ChildProcess.prototype.spawn as it was", () => {
    const original = childProcessPrototype().spawn
    expect(withBunSyncChannelFds(() => 7)).toBe(7)
    expect(childProcessPrototype().spawn).toBe(original)
  })

  it("restores spawn when the callback throws", () => {
    const original = childProcessPrototype().spawn
    expect(() =>
      withBunSyncChannelFds(() => {
        throw new Error("callback failed")
      }),
    ).toThrow("callback failed")
    expect(childProcessPrototype().spawn).toBe(original)
  })

  it.skipIf(!isBunPosix)("wraps spawn only while the callback runs", () => {
    const original = childProcessPrototype().spawn
    withBunSyncChannelFds(() => {
      const wrapped = childProcessPrototype().spawn as { name: string }
      expect(wrapped).not.toBe(original)
      expect(wrapped.name).toBe("spawnWithFds")
    })
    expect(childProcessPrototype().spawn).toBe(original)
  })

  it.skipIf(!isBunPosix)("leaves unrelated child processes without shim handles", async () => {
    withBunSyncChannelFds(() => 0)
    const child = spawn("sh", ["-c", "printf OK"], { stdio: ["pipe", "pipe", "inherit"] })
    const handle = (child.stdout as unknown as { _handle?: unknown } | null)?._handle
    let out = ""
    child.stdout?.on("data", (chunk) => {
      out += String(chunk)
    })
    await new Promise<void>((resolve) => child.on("close", () => resolve()))
    expect(handle ?? null).toBeNull()
    expect(out).toBe("OK")
  })

  it.skipIf(!isBunPosix)(
    "fails clearly, without patching spawn, when neither fd table exists",
    () => {
      const original = childProcessPrototype().spawn
      expect(() =>
        withBunSyncChannelFds(() => 1, { procFdDir: NO_TABLE, devFdDir: `${NO_TABLE}-dev` }),
      ).toThrow("neither")
      expect(childProcessPrototype().spawn).toBe(original)
    },
  )

  it.skipIf(!isBunPosix)(
    "switches the checker's pipes between blocking and non-blocking under the /dev/fd fallback",
    async () => {
      const child = withBunSyncChannelFds(
        () => spawn("sh", ["-c", "cat"], { stdio: ["pipe", "pipe", "inherit"] }),
        FALLBACK,
      )
      try {
        const stdout = child.stdout as unknown as { _handle?: PipeHandleLike | null }
        const stdin = child.stdin as unknown as { _handle?: PipeHandleLike | null }
        for (const handle of [stdin._handle, stdout._handle]) {
          expect(typeof handle?.fd).toBe("number")
          const fd = handle?.fd ?? -1
          handle?.setBlocking?.(false)
          expect(isNonBlocking(fd)).toBe(true)
          handle?.setBlocking?.(true)
          expect(isNonBlocking(fd)).toBe(false)
        }
      } finally {
        child.kill()
        await exited(child)
      }
    },
  )

  it.skipIf(!isBunPosix)("reports a failed spawn as the spawn failure", () => {
    expect(() =>
      withBunSyncChannelFds(() =>
        spawn("/nonexistent/tskm-checker", [], { stdio: ["pipe", "pipe", "inherit"] }),
      ),
    ).toThrow("could not start the checker process (/nonexistent/tskm-checker)")
  })
})

interface PipeHandleLike {
  readonly fd: number
  setBlocking?(blocking: boolean): void
}

// Spawns a child through the shim with `dirs`, so its two stdio pipes are the same kind of
// socketpair the checker gets. Returns those fds and a function that stops the child.
async function shimPipes(dirs: FdDirs): Promise<{ fds: number[]; stop(): Promise<void> }> {
  const child = withBunSyncChannelFds(
    () => spawn("sh", ["-c", "cat"], { stdio: ["pipe", "pipe", "inherit"] }),
    dirs,
  )
  const stdin = child.stdin as unknown as { _handle?: { fd: number } | null }
  const stdout = child.stdout as unknown as { _handle?: { fd: number } | null }
  const fds = [stdin._handle?.fd, stdout._handle?.fd]
  return {
    fds: fds.filter((fd): fd is number => typeof fd === "number"),
    stop: async () => {
      child.kill()
      await exited(child)
    },
  }
}

// A FIFO gives a pipe whose fstat kind is S_IFIFO on every POSIX platform.
function fifoFd(): number {
  const dir = mkdtempSync(join(tmpdir(), "tskm-fifo-"))
  const path = join(dir, "pipe")
  execFileSync("mkfifo", [path])
  try {
    return openSync(path, "r+")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function regularFileFd(): number {
  const dir = mkdtempSync(join(tmpdir(), "tskm-file-"))
  const path = join(dir, "file")
  writeFileSync(path, "x")
  try {
    return openSync(path, "r")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
