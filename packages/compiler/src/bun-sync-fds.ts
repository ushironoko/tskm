import { existsSync, fstatSync, readdirSync, readlinkSync } from "node:fs"
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
 * The checker's pipe fds are found by diffing the process fd table around the spawn.
 * Two tables are tried, in order:
 *
 * - procfs (`/proc/self/fd`, Linux). The identity is the link text (`socket:[inode]`).
 *   The handle is switched to blocking mode with fcntl.
 * - `/dev/fd` (macOS, and any POSIX platform without procfs). The identity is
 *   `st_dev:st_ino` from fstat. The handle is switched to blocking mode with fcntl, using
 *   a call that is correct under both the SysV/AAPCS64 and Apple arm64 variadic
 *   conventions (see `setBlockingVariadic`). If the switch does not take, the channel
 *   still works: it retries EAGAIN with a 1 ms sleep, only more slowly.
 *
 * When neither table exists the function throws, instead of patching spawn for every
 * caller.
 */

/** The directories that name the process's open descriptors, in preference order. */
export interface FdDirs {
  /** Linux procfs fd table. */
  readonly procFdDir: string
  /** Fallback table: `/dev/fd` (fdesc on macOS, a symlink to procfs on Linux). */
  readonly devFdDir: string
}

export const DEFAULT_FD_DIRS: FdDirs = { procFdDir: "/proc/self/fd", devFdDir: "/dev/fd" }

/** A source of the process's open descriptors and the identity of each socket or pipe. */
export interface FdTable {
  /** Every descriptor number the table reports as open. */
  list(): number[]
  /**
   * Identity of the socket or pipe behind `fd`. Undefined for anything else. A recycled
   * descriptor number keeps its key but gets a new identity.
   */
  identify(fd: number): string | undefined
  /** Switches the descriptor's blocking mode. Absent when this table cannot do so safely. */
  setBlocking?(fd: number, blocking: boolean): void
}

interface PipeStream {
  _handle?: PipeHandle | null
  unref?: () => PipeStream
  ref?: () => PipeStream
}

interface PipeHandle {
  readonly fd: number
  setBlocking?(blocking: boolean): void
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
 * A no-op outside Bun and on Windows. `dirs` is injectable for tests.
 */
export function withBunSyncChannelFds<T>(fn: () => T, dirs: FdDirs = DEFAULT_FD_DIRS): T {
  if (process.versions.bun === undefined || process.platform === "win32") {
    return fn()
  }
  const table = selectFdTable(dirs)
  if (table === undefined) {
    throw new Error(
      `tskm: Bun's checker channel finds its pipe fds in an fd table, and neither ${dirs.procFdDir} nor ${dirs.devFdDir} exists on this platform. Run the compiler under Node on this platform.`,
    )
  }
  const childProcess = process.getBuiltinModule("node:child_process") as unknown as {
    ChildProcess: { prototype: SpawnedChild }
  }
  const prototype = childProcess.ChildProcess.prototype
  const original = prototype.spawn
  prototype.spawn = function spawnWithFds(this: SpawnedChild, options?: { stdio?: unknown }) {
    const before = pipeIdentities(table)
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
      const created = newPipeFds(before, pipeIdentities(table))
      const pair = stdioPipePair(created)
      if (pair === undefined) {
        // Without exactly two fds the channel would fail on a null handle, or read and write the
        // wrong descriptor. Stop the child here and name the cause.
        this.kill()
        throw new Error(
          `tskm: could not identify the checker's stdio pipes (found ${created.length} new fds).`,
        )
      }
      stdin._handle = pipeHandle(pair[0], table)
      stdout._handle = pipeHandle(pair[1], table)
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

/**
 * The first fd table that exists, or undefined when neither does. procfs is preferred so
 * Linux keeps its existing behavior, including the link-text identity.
 */
export function selectFdTable(dirs: FdDirs = DEFAULT_FD_DIRS): FdTable | undefined {
  if (existsSync(dirs.procFdDir)) {
    return procfsTable(dirs.procFdDir)
  }
  if (existsSync(dirs.devFdDir)) {
    return devFdTable(dirs.devFdDir)
  }
  return undefined
}

/** Identity of every socket or pipe the table reports, keyed by descriptor number. */
export function pipeIdentities(table: FdTable): Map<number, string> {
  const found = new Map<number, string>()
  for (const fd of table.list()) {
    const identity = table.identify(fd)
    if (identity !== undefined) {
      found.set(fd, identity)
    }
  }
  return found
}

/** Descriptors that are new in `after`, or whose identity changed since `before`. */
export function newPipeFds(
  before: ReadonlyMap<number, string>,
  after: ReadonlyMap<number, string>,
): number[] {
  const created: number[] = []
  for (const [fd, identity] of after) {
    if (before.get(fd) !== identity) {
      created.push(fd)
    }
  }
  return created.sort((a, b) => a - b)
}

/**
 * The checker's two new descriptors, as `[stdin, stdout]`. Undefined unless there are exactly
 * two, so the caller fails closed. Taking the two lowest of three could hand the channel the
 * wrong descriptor if an extra socket, pipe, or kqueue appears during the spawn. Both
 * ends of Bun's socketpairs are duplex, so the order does not matter for them.
 */
export function stdioPipePair(created: readonly number[]): readonly [number, number] | undefined {
  const [writeFd, readFd, extra] = created
  if (writeFd === undefined || readFd === undefined || extra !== undefined) {
    return undefined
  }
  return [writeFd, readFd]
}

function numericEntries(dir: string): number[] {
  const fds: number[] = []
  for (const entry of readdirSync(dir)) {
    if (/^\d+$/.test(entry)) {
      fds.push(Number(entry))
    }
  }
  return fds
}

function procfsTable(dir: string): FdTable {
  return {
    list: () => numericEntries(dir),
    identify(fd) {
      try {
        const link = readlinkSync(`${dir}/${fd}`)
        return link.startsWith("socket:") || link.startsWith("pipe:") ? link : undefined
      } catch {
        // The fd can close between readdir and readlink.
        return undefined
      }
    },
    setBlocking: setBlockingWithFcntl,
  }
}

// S_IFMT and its socket and FIFO kinds. These values are the same on Linux and Darwin.
const S_IFMT = 0o170000
const S_IFIFO = 0o010000
const S_IFSOCK = 0o140000

function devFdTable(dir: string): FdTable {
  return {
    list: () => numericEntries(dir),
    identify(fd) {
      try {
        // bigint keeps inode numbers above 2^53 exact.
        const stat = fstatSync(fd, { bigint: true })
        const kind = Number(stat.mode) & S_IFMT
        // On Darwin st_dev is a signed int32, and an AF_UNIX socket reports NODEV, read as -1.
        // So dev can be negative, and st_ino tells sockets apart. XNU gives each AF_UNIX socket
        // an inode from a kernel-wide counter on its first fstat, so live sockets get distinct
        // values. Two edge
        // cases are left to the pair check: kqueue also reports S_IFIFO (dev and ino zero), and
        // the first socket fstat'd after boot can read ino 0 until its next fstat.
        return kind === S_IFSOCK || kind === S_IFIFO ? `${stat.dev}:${stat.ino}` : undefined
      } catch {
        // A closed fd fails fstat. The directory fd that readdir opened is S_IFDIR, so it
        // is skipped here.
        return undefined
      }
    },
    setBlocking: setBlockingVariadic,
  }
}

function pipeHandle(fd: number, table: FdTable): PipeHandle {
  const setBlocking = table.setBlocking
  if (setBlocking === undefined) {
    return { fd }
  }
  return { fd, setBlocking: (blocking: boolean) => setBlocking(fd, blocking) }
}

type Fcntl3 = (fd: number, cmd: number, arg: number) => number
type Fcntl9 = (
  fd: number,
  cmd: number,
  arg: number,
  unused4: number,
  unused5: number,
  unused6: number,
  unused7: number,
  unused8: number,
  arg9: number,
) => number

const F_GETFL = 3
const F_SETFL = 4

let procfsFcntl: Fcntl3 | undefined
let variadicFcntl: Fcntl9 | undefined

/** The procfs table's call: the three-argument fcntl the Linux path has always made. */
function setBlockingWithFcntl(fd: number, blocking: boolean): void {
  procfsFcntl ??= openFcntl(3) as Fcntl3
  const flags = procfsFcntl(fd, F_GETFL, 0)
  if (flags < 0) {
    return
  }
  const next = blocking ? flags & ~nonBlockingFlag() : flags | nonBlockingFlag()
  procfsFcntl(fd, F_SETFL, next)
}

/**
 * The `/dev/fd` table's call. fcntl is variadic, and bun:ffi cannot declare a variadic
 * signature. SysV and AAPCS64 read the third argument from a register. Apple's arm64
 * ABI reads it from the first stack slot, which is the ninth argument of this call.
 * Passing the flags in both places means each convention finds them, and each callee
 * ignores the slot its ABI does not use. The F_GETFL call passes zeros, which the callee
 * ignores.
 */
function setBlockingVariadic(fd: number, blocking: boolean): void {
  variadicFcntl ??= openFcntl(9) as Fcntl9
  const flags = variadicFcntl(fd, F_GETFL, 0, 0, 0, 0, 0, 0, 0)
  if (flags < 0) {
    return
  }
  const next = blocking ? flags & ~nonBlockingFlag() : flags | nonBlockingFlag()
  variadicFcntl(fd, F_SETFL, next, 0, 0, 0, 0, 0, next)
}

/** O_NONBLOCK: 0x4 on Darwin, 0o4000 on Linux. */
function nonBlockingFlag(): number {
  return process.platform === "darwin" ? 0x4 : 0o4000
}

/** Opens libc's fcntl with `argCount` int arguments. */
function openFcntl(argCount: 3 | 9): (...args: number[]) => number {
  const { dlopen, FFIType } = createRequire(import.meta.url)("bun:ffi") as {
    dlopen: (name: string, symbols: object) => { symbols: { fcntl: (...args: number[]) => number } }
    FFIType: { i32: unknown }
  }
  const symbols = {
    fcntl: {
      args: Array.from({ length: argCount }, () => FFIType.i32),
      returns: FFIType.i32,
    },
  }
  const names =
    process.platform === "darwin"
      ? ["libSystem.B.dylib"]
      : ["libc.so.6", `libc.musl-${process.arch}.so.1`]
  let last: unknown
  for (const name of names) {
    try {
      return dlopen(name, symbols).symbols.fcntl
    } catch (error) {
      last = error
    }
  }
  throw new Error(
    `tskm: Bun's sync channel needs libc fcntl to make checker pipes blocking (tried ${names.join(", ")}): ${last instanceof Error ? last.message : String(last)}`,
  )
}
