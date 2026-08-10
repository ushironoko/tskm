import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { markerPosition, sourceImportSpecifier, withQueryFile } from "../src/query-core.ts"
import type { ResolvedType, TsgoClient } from "../src/tsgo-client.ts"

/**
 * A TsgoClient stub that records the overlay lifecycle. Only the members `withQueryFile`
 * touches on the overlay branch are exercised; the resolve/diagnostic members throw so an
 * accidental disk-path fallthrough is loud rather than silently passing.
 */
const overlayClient = (): {
  client: TsgoClient
  log: Array<{ op: string; args: readonly string[] }>
} => {
  const log: Array<{ op: string; args: readonly string[] }> = []
  const client: TsgoClient = {
    updateFile: (absPath, kind) => {
      log.push({ op: `updateFile:${kind}`, args: [absPath] })
    },
    updateFiles: () => {
      throw new Error("updateFiles must not be used on the overlay path")
    },
    supportsOverlay: true,
    applyOverlay: (entries) => {
      log.push({ op: "applyOverlay", args: entries.map((e) => `${e.document}=${e.text}`) })
    },
    clearOverlay: (documents) => {
      log.push({ op: "clearOverlay", args: [...documents] })
    },
    withSnapshot: (fn) => fn(() => null),
    resolveTypeAt: (): ResolvedType | null => null,
    getDiagnostics: () => [],
    close: () => {},
  }
  return { client, log }
}

describe("withQueryFile — in-memory overlay path (supportsOverlay: true)", () => {
  it("registers the body as an overlay, never writes to disk, and clears it after fn", () => {
    const { client, log } = overlayClient()
    const queryFileAbs = join(tmpdir(), "tskm-overlay-does-not-exist.tskm-query.ts")

    const result = withQueryFile(client, queryFileAbs, "type Q = 1", () => {
      // The overlay must be registered before fn runs, and no real file may exist for it.
      expect(existsSync(queryFileAbs)).toBe(false)
      return "value-from-fn"
    })

    expect(result).toBe("value-from-fn")
    expect(existsSync(queryFileAbs)).toBe(false)
    expect(log).toEqual([
      { op: "applyOverlay", args: [`${queryFileAbs}=type Q = 1`] },
      { op: "clearOverlay", args: [queryFileAbs] },
    ])
  })

  it("clears the overlay even when fn throws (finally)", () => {
    const { client, log } = overlayClient()
    const queryFileAbs = join(tmpdir(), "tskm-overlay-throw.tskm-query.ts")

    expect(() =>
      withQueryFile(client, queryFileAbs, "type Q = 2", () => {
        throw new Error("boom")
      }),
    ).toThrow("boom")

    // The overlay was registered and then torn down despite the throw — no leak.
    expect(log.map((e) => e.op)).toEqual(["applyOverlay", "clearOverlay"])
  })
})

describe("withQueryFile — disk fallback path (supportsOverlay: false)", () => {
  it("writes the query file, registers it, then deletes it after fn (created + deleted)", () => {
    const dir = mkdtempSync(join(tmpdir(), "tskm-query-core-"))
    const queryFileAbs = join(dir, "mod.tskm-query.ts")
    const seen: string[] = []
    const client: TsgoClient = {
      updateFile: (absPath, kind) => {
        seen.push(`${kind}:${existsSync(absPath)}`)
      },
      updateFiles: () => {},
      supportsOverlay: false,
      applyOverlay: () => {
        throw new Error("applyOverlay must not be used on the disk path")
      },
      clearOverlay: () => {
        throw new Error("clearOverlay must not be used on the disk path")
      },
      withSnapshot: (fn) => fn(() => null),
      resolveTypeAt: () => null,
      getDiagnostics: () => [],
      close: () => {},
    }

    try {
      const out = withQueryFile(client, queryFileAbs, "type Q = 3", () => {
        // Inside fn the real file exists on disk (created + registered).
        expect(existsSync(queryFileAbs)).toBe(true)
        return 42
      })
      expect(out).toBe(42)
      // The file was created (present at register) then deleted (absent at register).
      expect(seen).toEqual(["created:true", "deleted:false"])
      expect(existsSync(queryFileAbs)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("query-core marker helpers", () => {
  it("sourceImportSpecifier drops the directory and extension", () => {
    expect(sourceImportSpecifier("/a/b/user.schema.ts")).toBe("./user.schema")
    expect(sourceImportSpecifier("node.ts")).toBe("./node")
  })

  it("markerPosition points at the identifier right after `declare const `", () => {
    const body = "type __P<T> = T\ndeclare const __tskm_0: number"
    const pos = markerPosition(body, "__tskm_0")
    expect(body.slice(pos)).toBe("__tskm_0: number")
  })
})
