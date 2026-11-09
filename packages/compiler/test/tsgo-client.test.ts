import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import {
  FAILURE_TYPE_FLAGS,
  resolveTsgoExecutable,
  TYPE_TO_STRING_FLAGS,
  toFileDiagnostics,
} from "../src/tsgo-client.ts"

// Whether the real checker binary resolves in this environment. The no-override
// branch reaches into the typescript platform package, which may be absent on
// unsupported platforms; guard those cases with skipIf rather than letting them hard-fail.
const tsgoAvailable = (() => {
  try {
    return existsSync(resolveTsgoExecutable())
  } catch {
    return false
  }
})()

describe("exported flag constants", () => {
  it("TYPE_TO_STRING_FLAGS is the expected bitmask number", () => {
    expect(typeof TYPE_TO_STRING_FLAGS).toBe("number")
    expect(TYPE_TO_STRING_FLAGS).toBe(545259529)
    // NoTruncation | UseStructuralFallback | InTypeAlias | NoTypeReduction — a positive,
    // integral mask. The exact components are folded into the single empirical value.
    expect(Number.isInteger(TYPE_TO_STRING_FLAGS)).toBe(true)
    expect(TYPE_TO_STRING_FLAGS).toBeGreaterThanOrEqual(1)
  })

  it("FAILURE_TYPE_FLAGS is Any | Unknown | Never", () => {
    expect(typeof FAILURE_TYPE_FLAGS).toBe("number")
    // Any (1) | Unknown (2) | Never (262144) — combined bitmask.
    expect(FAILURE_TYPE_FLAGS).toBe(1 | 2 | 262144)
    expect(FAILURE_TYPE_FLAGS).toBe(262147)
    expect(Number.isInteger(FAILURE_TYPE_FLAGS)).toBe(true)
  })

  it("each failure component bit is set in the mask", () => {
    expect(FAILURE_TYPE_FLAGS & 1).toBe(1)
    expect(FAILURE_TYPE_FLAGS & 2).toBe(2)
    expect(FAILURE_TYPE_FLAGS & 262144).toBe(262144)
  })
})

describe("resolveTsgoExecutable — override branch", () => {
  it("throws with a 'not found' message when the override path does not exist", () => {
    expect(() => resolveTsgoExecutable("/no/such/tsgo")).toThrow("not found")
  })

  it("includes the offending path in the error message", () => {
    expect(() => resolveTsgoExecutable("/no/such/tsgo")).toThrow(
      "tskm: configured tsgo executable not found: /no/such/tsgo",
    )
  })

  it("returns the override verbatim when the path exists", () => {
    // Any existing file satisfies the existsSync gate; this module file itself works.
    const existing = import.meta.url.replace(/^file:\/\//, "")
    expect(existsSync(existing)).toBe(true)
    expect(resolveTsgoExecutable(existing)).toBe(existing)
  })
})

describe("resolveTsgoExecutable — no override branch", () => {
  it.skipIf(!tsgoAvailable)("returns the native tsc binary shipped with typescript", () => {
    const exe = resolveTsgoExecutable()
    expect(typeof exe).toBe("string")
    expect(exe.length).toBeGreaterThanOrEqual(1)
    expect(exe.endsWith(`${process.platform === "win32" ? "tsc.exe" : "tsc"}`)).toBe(true)
    expect(exe).toContain(`${process.platform}-${process.arch}`)
    expect(existsSync(exe)).toBe(true)
  })
})

describe("toFileDiagnostics", () => {
  it("fails closed when the payload is not an array", () => {
    expect(toFileDiagnostics(undefined, "/proj/q.ts")).toEqual([
      { code: -1, fileName: "/proj/q.ts" },
    ])
    expect(toFileDiagnostics({ code: 2322 }, "/proj/q.ts")).toEqual([
      { code: -1, fileName: "/proj/q.ts" },
    ])
  })

  it("reports an empty array as no diagnostics", () => {
    expect(toFileDiagnostics([], "/proj/q.ts")).toEqual([])
  })

  it("keeps the probe file's diagnostics and their message text", () => {
    expect(
      toFileDiagnostics(
        [
          { code: 2304, fileName: "/proj/q.ts", text: "Cannot find name 'Missing'." },
          { code: 2322, fileName: "/proj/other.ts", text: "elsewhere" },
          { code: 1, text: "no file" },
        ],
        "/proj/q.ts",
      ),
    ).toEqual([
      { code: 2304, fileName: "/proj/q.ts", text: "Cannot find name 'Missing'." },
      { code: 1, fileName: "/proj/q.ts", text: "no file" },
    ])
  })

  it("fails closed on a malformed entry and keeps the valid ones", () => {
    expect(
      toFileDiagnostics(
        [{ code: 2304, fileName: "/proj/q.ts", text: "Cannot find name 'X'." }, null, "bogus"],
        "/proj/q.ts",
      ),
    ).toEqual([
      { code: 2304, fileName: "/proj/q.ts", text: "Cannot find name 'X'." },
      { code: -1, fileName: "/proj/q.ts" },
      { code: -1, fileName: "/proj/q.ts" },
    ])
    expect(toFileDiagnostics([null], "/proj/q.ts")).toEqual([{ code: -1, fileName: "/proj/q.ts" }])
  })

  it("matches a native-separator probe path against the checker's slash-normalized name", () => {
    // The checker reports RootedFilePath values, which use forward slashes. A Windows
    // probe path built with path.join uses backslashes; both must compare equal.
    expect(
      toFileDiagnostics(
        [{ code: 2322, fileName: "C:/proj/q.ts", text: "Type 'string' is not assignable." }],
        "C:\\proj\\q.ts",
      ),
    ).toEqual([{ code: 2322, fileName: "C:/proj/q.ts", text: "Type 'string' is not assignable." }])
  })

  it("still drops another file's diagnostics when the separators differ", () => {
    expect(
      toFileDiagnostics([{ code: 2322, fileName: "C:/proj/other.ts" }], "C:\\proj\\q.ts"),
    ).toEqual([])
  })
})
