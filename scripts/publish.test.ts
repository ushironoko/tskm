import { describe, expect, test } from "bun:test"
import {
  type CmdResult,
  publishDecision,
  type Runner,
  resolveWorkspaceRange,
  rewriteWorkspaceDeps,
} from "./publish.ts"

const ok = (stdout: string): CmdResult => ({ status: 0, stdout, stderr: "" })
const err = (stdout: string, stderr: string): CmdResult => ({ status: 1, stdout, stderr })

describe("resolveWorkspaceRange", () => {
  test("`workspace:*` becomes a caret range on the current version", () => {
    expect(resolveWorkspaceRange("workspace:*", "0.0.2")).toBe("^0.0.2")
  })
  test("`workspace:^` and `workspace:~` keep their range operator", () => {
    expect(resolveWorkspaceRange("workspace:^", "1.2.3")).toBe("^1.2.3")
    expect(resolveWorkspaceRange("workspace:~", "1.2.3")).toBe("~1.2.3")
  })
  test("an explicit `workspace:^1.2.3` keeps the pinned range", () => {
    expect(resolveWorkspaceRange("workspace:^1.2.3", "9.9.9")).toBe("^1.2.3")
  })
})

describe("rewriteWorkspaceDeps", () => {
  test("rewrites a sibling `workspace:*` dependency to a concrete range", () => {
    const manifest = { dependencies: { "@tskm/compiler": "workspace:*", vite: ">=5" } }
    const changed = rewriteWorkspaceDeps(manifest, new Map([["@tskm/compiler", "0.0.2"]]))
    expect(changed).toBe(true)
    expect(manifest.dependencies["@tskm/compiler"]).toBe("^0.0.2")
    expect(manifest.dependencies.vite).toBe(">=5") // untouched
  })

  test("returns false when there is nothing to rewrite", () => {
    const manifest = { dependencies: { vite: ">=5" } }
    expect(rewriteWorkspaceDeps(manifest, new Map())).toBe(false)
  })

  test("fail-closed: throws when a workspace dep has no known version", () => {
    const manifest = { dependencies: { "@tskm/compiler": "workspace:*" } }
    expect(() => rewriteWorkspaceDeps(manifest, new Map())).toThrow(/no workspace version/)
  })
})

describe("publishDecision (fail-closed)", () => {
  const mock =
    (result: CmdResult): Runner =>
    () =>
      result

  test("skips when the exact version is already on the registry", () => {
    const run = mock(ok(JSON.stringify(["0.0.1", "0.0.2"])))
    expect(publishDecision(run, "tskm", "0.0.2")).toBe("published")
  })

  test("publishes when the package exists but this version does not", () => {
    const run = mock(ok(JSON.stringify(["0.0.1"])))
    expect(publishDecision(run, "tskm", "0.0.2")).toBe("publish")
  })

  test("publishes when the package has never been published (E404)", () => {
    const run = mock(err(JSON.stringify({ error: { code: "E404" } }), ""))
    expect(publishDecision(run, "tskm", "0.0.1")).toBe("publish")
  })

  test("publishes on E404 reported only in stderr text", () => {
    const run = mock(err("", "npm error code E404\nnpm error 404 Not Found"))
    expect(publishDecision(run, "@tskm/compiler", "0.0.1")).toBe("publish")
  })

  test("fail-closed: throws on a network error rather than skipping or blind-publishing", () => {
    const run = mock(err("", "npm error code ENOTFOUND\nnpm error network request failed"))
    expect(() => publishDecision(run, "tskm", "0.0.1")).toThrow(/fail-closed/)
  })

  test("fail-closed: throws on auth errors (ENEEDAUTH)", () => {
    const run = mock(err("", "npm error code ENEEDAUTH"))
    expect(() => publishDecision(run, "tskm", "0.0.1")).toThrow(/fail-closed/)
  })
})
