import { existsSync, readdirSync, readlinkSync } from "node:fs"
import { createRequire } from "node:module"

/**
 * Bun's `child_process` pipes are socketpairs and do not expose `stdout._handle.fd`.
 * TypeScript's sync channel reads that fd and calls `readSync` on it. Node already
 * provides the handle, and Windows Bun uses the channel's own named-pipe path, so the
 * shim is only needed under Bun on POSIX.
 *
 * The shim is scoped to one call. `withBunSyncChannelFds` swaps the wrapper onto
 * `ChildProcess.prototype.spawn` for the duration of the callback and restores the
 * original afterwards. The checker's channel spawns synchronously in its constructor,
 * so the callback is just `new API(...)`, and child processes spawned elsewhere in the
 * same process never see the wrapper.
 *
 * Pipe fds are identified by diffing the process fd table around the spawn. That
 * table is procfs (`/proc/self/fd`). A platform without it (macOS) cannot be served,
 * so the function throws instead of patching spawn for every caller.
 */

/** The process fd table that Linux procfs exposes. */
export const PROC_FD_DIR = "/proc/self/fd"

interface PipeStream {
  _handle?: { fd: number; setBlocking(blocking: boolean): void } | null
  unref?: () => PipeStream
  ref?: () => PipeStream
}

interface SpawnedChild {
  stdin: PipeStream | null
  stdout: PipeStream | null
  spawnfile?: string
  pid?: number
  kill(): boolean
  on(event: "error", listener: () => void): unknown
  spawn(options?: { stdio?: unknown }): unknown
}

/**
 * Runs `fn` with Bun's `spawn` wrapped so the pipes it creates expose POSIX fds.
 * A no-op outside Bun and on Windows. `procFdDir` is injectable for tests.
 */
export function withBunSyncChannelFds<T>(fn: () => T, procFdDir: string = PROC_FD_DIR): T {
  if (process.versions.bun === undefined || process.platform === "win32") {
    return fn()
  }
  if (!existsSync(procFdDir)) {
    throw new Error(
      `tskm: Bun's checker channel reads its pipe fds from ${procFdDir}, which this platform does not provide. Run the compiler under Node on this platform.`,
    )
  }
  const childProcess = process.getBuiltinModule("node:child_process") as unknown as {
    ChildProcess: { prototype: SpawnedChild }
  }
  const prototype = childProcess.ChildProcess.prototype
  const original = prototype.spawn
  prototype.spawn = function spawnWithFds(this: SpawnedChild, options?: { stdio?: unknown }) {
    const before = socketFds(procFdDir)
    const result = original.call(this, options)
    if (this.pid === undefined) {
      // A failed spawn (ENOENT, EACCES) has no pipes to identify. Node and Bun also emit
      // it as an 'error' event on a later tick, and with no listener that event crashes
      // the process and hides this error, so take the listener and report the failure here.
      this.on("error", () => {})
      throw new Error(`tskm: could not start the checker process (${this.spawnfile ?? "unknown"}).`)
    }
    const stdio = options?.stdio
    const piped = Array.isArray(stdio) && stdio[0] === "pipe" && stdio[1] === "pipe"
    const stdout = this.stdout
    const stdin = this.stdin
    if (piped && stdin !== null && stdout !== null && stdout._handle == null) {
      const created = newPipeFds(before, procFdDir)
      const writeFd = created[0]
      const readFd = created[1]
      if (writeFd === undefined || readFd === undefined) {
        // Without the pair the channel would fail on a null handle and leave this child
        // running, so stop it here and name the cause.
        this.kill()
        throw new Error(
          `tskm: could not identify the checker's stdio pipes (found ${created.length} new fds).`,
        )
      }
      stdin._handle = blockingHandle(writeFd)
      stdout._handle = blockingHandle(readFd)
      stdin.unref ??= () => stdin
      stdin.ref ??= () => stdin
    }
    return result
  }
  try {
    return fn()
  } finally {
    prototype.spawn = original
  }
}

function socketFds(procFdDir: string): Map<number, string> {
  const found = new Map<number, string>()
  for (const entry of readdirSync(procFdDir)) {
    const fd = Number(entry)
    if (!Number.isInteger(fd)) continue
    try {
      const link = readlinkSync(`${procFdDir}/${entry}`)
      // Bun's stdio pipes are socketpairs. A recycled fd number keeps the old
      // key but points at a new inode, so identity is the link text, not the number.
      if (link.startsWith("socket:") || link.startsWith("pipe:")) found.set(fd, link)
    } catch {
      // The fd can close between readdir and readlink.
    }
  }
  return found
}

function newPipeFds(before: Map<number, string>, procFdDir: string): number[] {
  const created: number[] = []
  for (const [fd, link] of socketFds(procFdDir)) {
    if (before.get(fd) !== link) created.push(fd)
  }
  return created.sort((a, b) => a - b)
}

interface FcntlLib {
  symbols: {
    fcntl(fd: number, cmd: number, flags: number): number
  }
}

let fcntlLib: FcntlLib | undefined

function blockingHandle(fd: number): { fd: number; setBlocking(blocking: boolean): void } {
  return {
    fd,
    setBlocking(blocking: boolean): void {
      const lib = loadFcntl()
      const flags = lib.symbols.fcntl(fd, F_GETFL, 0)
      if (flags < 0) {
        return
      }
      const next = blocking ? flags & ~nonBlockingFlag() : flags | nonBlockingFlag()
      lib.symbols.fcntl(fd, F_SETFL, next)
    },
  }
}

const F_GETFL = 3
const F_SETFL = 4

function nonBlockingFlag(): number {
  // Linux O_NONBLOCK is 0o4000. Darwin's is 0x4.
  return process.platform === "darwin" ? 0x4 : 0o4000
}

function loadFcntl(): FcntlLib {
  if (fcntlLib) {
    return fcntlLib
  }
  const { dlopen, FFIType } = createRequire(import.meta.url)("bun:ffi") as {
    dlopen: (name: string, symbols: object) => FcntlLib
    FFIType: { i32: unknown }
  }
  const symbols = {
    fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  }
  const names =
    process.platform === "darwin"
      ? ["libSystem.B.dylib"]
      : ["libc.so.6", `libc.musl-${process.arch}.so.1`]
  let last: unknown
  for (const name of names) {
    try {
      fcntlLib = dlopen(name, symbols)
      return fcntlLib
    } catch (error) {
      last = error
    }
  }
  throw new Error(
    `tskm: Bun's sync channel needs libc fcntl to make checker pipes blocking (tried ${names.join(", ")}): ${last instanceof Error ? last.message : String(last)}`,
  )
}
