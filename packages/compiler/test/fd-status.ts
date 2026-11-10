import { dlopen, FFIType } from "bun:ffi"

/**
 * Test-only reads of a descriptor's status flags (F_GETFL), for checking the shim's
 * blocking mode. Only the call's first argument matters to F_GETFL, so the three-argument
 * signature is correct on every ABI.
 */

const F_GETFL = 3

/** O_NONBLOCK on this platform: 0x4 on Darwin, 0o4000 on Linux. */
export const O_NONBLOCK = process.platform === "darwin" ? 0x4 : 0o4000

type Getfl = (fd: number, cmd: number, arg: number) => number

let getfl: Getfl | undefined

export function statusFlags(fd: number): number {
  if (getfl === undefined) {
    const names =
      process.platform === "darwin"
        ? ["libSystem.B.dylib"]
        : ["libc.so.6", `libc.musl-${process.arch}.so.1`]
    const symbols = {
      fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    }
    let last: unknown
    for (const name of names) {
      try {
        getfl = dlopen(name, symbols).symbols.fcntl as Getfl
        break
      } catch (error) {
        last = error
      }
    }
    if (getfl === undefined) {
      throw last
    }
  }
  return getfl(fd, F_GETFL, 0)
}

/** True when `fd` is in non-blocking mode. */
export function isNonBlocking(fd: number): boolean {
  return (statusFlags(fd) & O_NONBLOCK) !== 0
}
