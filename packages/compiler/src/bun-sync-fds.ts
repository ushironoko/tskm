import { readdirSync, readlinkSync } from "node:fs"
import { createRequire } from "node:module"

/**
 * Bun's `child_process` pipes are socketpairs and do not expose `stdout._handle.fd`.
 * TypeScript's sync channel reads that fd and calls `readSync` on it. Node already
 * provides the handle. The wrapper sits on `ChildProcess.prototype.spawn`, which
 * the already-imported `spawn` function calls, so it still applies when some other
 * module imported `node:child_process` first (Vite does). Windows Bun uses the
 * channel's own named-pipe path, so it is left alone.
 */
let installed = false

interface PipeStream {
  _handle?: { fd: number; setBlocking(blocking: boolean): void } | null
  unref?: () => PipeStream
  ref?: () => PipeStream
}

interface SpawnedChild {
  stdin: PipeStream | null
  stdout: PipeStream | null
  spawn(options?: { stdio?: unknown }): unknown
}

export function installBunSyncChannelFds(): void {
  if (installed || process.versions.bun === undefined || process.platform === "win32") {
    return
  }
  installed = true
  const childProcess = process.getBuiltinModule("node:child_process") as unknown as {
    ChildProcess: { prototype: SpawnedChild }
  }
  const original = childProcess.ChildProcess.prototype.spawn
  childProcess.ChildProcess.prototype.spawn = function spawnWithFds(
    this: SpawnedChild,
    options?: { stdio?: unknown },
  ) {
    const before = socketFds()
    const result = original.call(this, options)
    const stdio = options?.stdio
    const piped = Array.isArray(stdio) && stdio[0] === "pipe" && stdio[1] === "pipe"
    const stdout = this.stdout
    const stdin = this.stdin
    if (piped && stdin !== null && stdout !== null && stdout._handle == null) {
      const created = [...socketFds().keys()].filter((fd) => !before.has(fd)).sort((a, b) => a - b)
      const writeFd = created[0]
      const readFd = created[1]
      if (writeFd !== undefined && readFd !== undefined) {
        stdin._handle = blockingHandle(writeFd)
        stdout._handle = blockingHandle(readFd)
        stdin.unref ??= () => stdin
        stdin.ref ??= () => stdin
      }
    }
    return result
  }
}

export function withBunSyncChannelFds<T>(fn: () => T): T {
  installBunSyncChannelFds()
  return fn()
}

function socketFds(): Map<number, string> {
  const found = new Map<number, string>()
  for (const entry of readdirSync("/proc/self/fd")) {
    const fd = Number(entry)
    if (!Number.isInteger(fd)) {
      continue
    }
    try {
      const link = readlinkSync(`/proc/self/fd/${entry}`)
      if (link.startsWith("socket:")) {
        found.set(fd, link)
      }
    } catch {
      // The fd can close between readdir and readlink.
    }
  }
  return found
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
