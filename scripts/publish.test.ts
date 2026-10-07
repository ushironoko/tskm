import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type CmdResult,
  discoverPackages,
  type PkgInfo,
  publishDecision,
  publishOne,
  type Runner,
  realRunner,
  resolveWorkspaceRange,
  rewriteWorkspaceDeps,
  run,
} from "./publish.ts"

const ok = (stdout: string): CmdResult => ({ status: 0, stdout, stderr: "" })
const err = (stdout: string, stderr: string): CmdResult => ({ status: 1, stdout, stderr })

// Builds a workspace root under a temp dir with the given packages, each written as a real
// package.json so the fs-backed discovery/rewrite/restore logic runs against actual files.
function makeWorkspace(
  packages: ReadonlyArray<{ dir: string; manifest: Record<string, unknown> }>,
): string {
  const root = mkdtempSync(join(tmpdir(), "tskm-publish-"))
  for (const { dir, manifest } of packages) {
    const pkgDir = join(root, "packages", dir)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return root
}

// A Runner that fakes the external npm/tar calls publishOne makes. `npm view` reports the
// package as absent (so it always publishes), `npm pack` yields a tarball name, and `tar`
// actually materialises the extracted manifest so the workspace-leak assertion reads a real
// file. `leak` controls whether that extracted manifest still carries a `workspace:` spec.
function fakePublishRunner(opts: { leak?: boolean } = {}): Runner {
  return (cmd, args) => {
    if (cmd === "npm" && args[0] === "view") return ok(JSON.stringify(["0.0.0"]))
    if (cmd === "npm" && args[0] === "pack") return ok(JSON.stringify([{ filename: "pkg.tgz" }]))
    if (cmd === "tar") {
      const dest = args[args.indexOf("-C") + 1]
      if (dest === undefined) throw new Error("fake tar: missing -C destination")
      mkdirSync(join(dest, "package"), { recursive: true })
      const dep = opts.leak ? "workspace:*" : "^1.0.0"
      writeFileSync(
        join(dest, "package", "package.json"),
        JSON.stringify({ name: "x", dependencies: { "@tskm/compiler": dep } }),
      )
      return ok("")
    }
    if (cmd === "npm" && args[0] === "publish") return ok("")
    return ok("")
  }
}

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempRoot(packages: Parameters<typeof makeWorkspace>[0]): string {
  const root = makeWorkspace(packages)
  cleanups.push(root)
  return root
}

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

  test("fail-closed: throws when a successful `npm view` returns unparseable JSON", () => {
    const run = mock(ok("not json at all"))
    expect(() => publishDecision(run, "tskm", "0.0.1")).toThrow(/Cannot parse/)
  })
})

describe("discoverPackages", () => {
  test("returns every public package and skips private ones and non-package dirs", () => {
    const root = tempRoot([
      { dir: "compiler", manifest: { name: "@tskm/compiler", version: "1.0.0" } },
      { dir: "core", manifest: { name: "@tskm/core", version: "2.0.0" } },
      { dir: "secret", manifest: { name: "@tskm/secret", version: "9.9.9", private: true } },
    ])
    // A directory without a package.json must be ignored, not throw.
    mkdirSync(join(root, "packages", "empty"))

    const found = discoverPackages(root)
    const byName = Object.fromEntries(found.map((p) => [p.name, p.version]))

    expect(found).toHaveLength(2)
    expect(byName["@tskm/compiler"]).toBe("1.0.0")
    expect(byName["@tskm/core"]).toBe("2.0.0")
    expect(byName["@tskm/secret"]).toBeUndefined()
  })
})

describe("publishOne", () => {
  const pkg = (dir: string): PkgInfo => ({ name: "@tskm/vite", version: "1.0.0", dir })

  test("skips a package whose version is already on the registry", () => {
    const root = tempRoot([{ dir: "vite", manifest: { name: "@tskm/vite", version: "1.0.0" } }])
    const dir = join(root, "packages", "vite")
    const original = readFileSync(join(dir, "package.json"), "utf8")

    // `npm view` reports the version as present -> skip before any pack/publish.
    const run: Runner = () => ok(JSON.stringify(["1.0.0"]))
    publishOne(run, pkg(dir), new Map([["@tskm/vite", "1.0.0"]]), { dryRun: true })

    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(original)
  })

  test("rewrites workspace deps, validates the pack, then restores the source manifest", () => {
    const root = tempRoot([
      {
        dir: "vite",
        manifest: {
          name: "@tskm/vite",
          version: "1.0.0",
          dependencies: { "@tskm/compiler": "workspace:*" },
        },
      },
    ])
    const dir = join(root, "packages", "vite")
    const original = readFileSync(join(dir, "package.json"), "utf8")

    publishOne(fakePublishRunner(), pkg(dir), new Map([["@tskm/compiler", "1.0.0"]]), {
      dryRun: true,
    })

    // The source manifest is restored to its `workspace:` form after the dry-run.
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(original)
    expect(original).toContain("workspace:*")
  })

  test("performs the real publish when not in dry-run mode", () => {
    const root = tempRoot([{ dir: "vite", manifest: { name: "@tskm/vite", version: "1.0.0" } }])
    const dir = join(root, "packages", "vite")
    const published: string[] = []
    const run: Runner = (cmd, args) => {
      if (cmd === "npm" && args[0] === "publish") {
        published.push(dir)
        return ok("")
      }
      return fakePublishRunner()(cmd, args)
    }

    publishOne(run, pkg(dir), new Map(), { dryRun: false })
    expect(published).toEqual([dir])
  })

  test("throws when the real `npm publish` call fails", () => {
    const root = tempRoot([{ dir: "vite", manifest: { name: "@tskm/vite", version: "1.0.0" } }])
    const dir = join(root, "packages", "vite")
    const run: Runner = (cmd, args) => {
      if (cmd === "npm" && args[0] === "publish") return err("", "402 Payment Required")
      return fakePublishRunner()(cmd, args)
    }

    expect(() => publishOne(run, pkg(dir), new Map(), { dryRun: false })).toThrow(
      /npm publish failed/,
    )
  })

  test("throws when `npm pack` fails during the workspace-leak check", () => {
    const root = tempRoot([{ dir: "vite", manifest: { name: "@tskm/vite", version: "1.0.0" } }])
    const dir = join(root, "packages", "vite")
    const run: Runner = (cmd, args) => {
      if (cmd === "npm" && args[0] === "pack") return err("", "pack exploded")
      return fakePublishRunner()(cmd, args)
    }

    expect(() => publishOne(run, pkg(dir), new Map(), { dryRun: true })).toThrow(/npm pack failed/)
  })

  test("aborts (and restores) when the packed tarball still carries a workspace spec", () => {
    const root = tempRoot([
      {
        dir: "vite",
        manifest: {
          name: "@tskm/vite",
          version: "1.0.0",
          dependencies: { "@tskm/compiler": "workspace:*" },
        },
      },
    ])
    const dir = join(root, "packages", "vite")
    const original = readFileSync(join(dir, "package.json"), "utf8")

    expect(() =>
      publishOne(
        fakePublishRunner({ leak: true }),
        pkg(dir),
        new Map([["@tskm/compiler", "1.0.0"]]),
        { dryRun: true },
      ),
    ).toThrow(/workspace:` protocol leaked/)

    // Even on abort, the original manifest must be restored.
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(original)
  })
})

describe("run", () => {
  const fullWorkspace = () =>
    tempRoot([
      {
        dir: "compiler",
        manifest: { name: "@tskm/compiler", version: "1.0.0" },
      },
      {
        dir: "core",
        manifest: {
          name: "@tskm/core",
          version: "1.0.0",
          dependencies: { "@tskm/compiler": "workspace:*" },
        },
      },
      {
        dir: "vite",
        manifest: {
          name: "@tskm/vite",
          version: "1.0.0",
          dependencies: { "@tskm/compiler": "workspace:*" },
        },
      },
    ])

  const withCwd = (root: string, fn: () => void) => {
    const prev = process.cwd()
    process.chdir(root)
    try {
      fn()
    } finally {
      process.chdir(prev)
    }
  }

  test("throws when a package in PUBLISH_ORDER is missing from the workspace", () => {
    const root = tempRoot([
      { dir: "compiler", manifest: { name: "@tskm/compiler", version: "1.0.0" } },
    ])
    withCwd(root, () => {
      expect(() => run(["--dry-run"], fakePublishRunner())).toThrow(/not found under packages/)
    })
  })

  test("dry-run walks every package in dependency order without publishing", () => {
    const root = fullWorkspace()
    withCwd(root, () => {
      expect(() => run(["--dry-run"], fakePublishRunner())).not.toThrow()
    })
    // All source manifests keep their workspace: form after the dry-run.
    expect(readFileSync(join(root, "packages", "vite", "package.json"), "utf8")).toContain(
      "workspace:*",
    )
  })

  test("--check reports should_publish and writes it to GITHUB_OUTPUT", () => {
    const root = fullWorkspace()
    const outFile = join(root, "gh-output.txt")
    writeFileSync(outFile, "")
    const prevOut = process.env.GITHUB_OUTPUT
    process.env.GITHUB_OUTPUT = outFile
    try {
      // `npm view` reports the versions as absent -> should_publish=true.
      withCwd(root, () => run(["--check"], fakePublishRunner()))
    } finally {
      if (prevOut === undefined) delete process.env.GITHUB_OUTPUT
      else process.env.GITHUB_OUTPUT = prevOut
    }
    expect(readFileSync(outFile, "utf8")).toContain("should_publish=true")
  })
})

describe("realRunner", () => {
  test("captures stdout and a zero status for a successful command", () => {
    const result = realRunner(process.execPath, ["-e", "process.stdout.write('hello')"])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("hello")
    expect(result.stderr).toBe("")
  })

  test("captures the non-zero status and stderr for a failing command", () => {
    const result = realRunner(process.execPath, [
      "-e",
      "process.stderr.write('boom'); process.exit(3)",
    ])
    expect(result.status).toBe(3)
    expect(result.stderr).toContain("boom")
  })
})
