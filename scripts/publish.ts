// Ordered, fail-closed npm publish for the tskm workspace.
//
// Why this exists instead of `bun publish` / `changeset publish`:
// - `bun publish` cannot do npm OIDC trusted publishing or provenance (bun#15601).
// - npm does NOT reliably rewrite the `workspace:` protocol on publish, so a naive
//   `npm publish` would ship `@tskm/vite` with `"@tskm/compiler": "workspace:*"`,
//   which no npm consumer can install. We rewrite it to a concrete range first.
//
// Flow per package (in dependency order compiler -> tskm -> vite):
//   1. Ask the registry whether this exact version already exists.
//      published -> skip; truly absent (E404) -> publish; any other error -> FAIL.
//   2. Rewrite sibling `workspace:` deps to a concrete range in-place (cwd stays in
//      the repo so npm provenance keeps working), then publish, then restore.
//   3. Before publishing, pack and assert the `workspace:` protocol did not leak.

import { execFileSync } from "node:child_process"
import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export type CmdResult = { status: number; stdout: string; stderr: string }
export type Runner = (cmd: string, args: string[], opts?: { cwd?: string }) => CmdResult

export type PkgInfo = { name: string; version: string; dir: string }

// Dependency order: vite depends on compiler, so compiler must reach the registry first.
export const PUBLISH_ORDER = ["@tskm/compiler", "@tskm/core", "@tskm/vite"] as const

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const

const WORKSPACE_PREFIX = "workspace:"

// `workspace:*` -> `^x.y.z`, `workspace:~` -> `~x.y.z`, `workspace:^1.2.3` -> `^1.2.3`.
export function resolveWorkspaceRange(spec: string, version: string): string {
  const rest = spec.slice(WORKSPACE_PREFIX.length)
  if (rest === "" || rest === "*") return `^${version}`
  if (rest === "^") return `^${version}`
  if (rest === "~") return `~${version}`
  return rest // already an explicit range like ^1.2.3
}

// Replaces every `workspace:` dependency value with a concrete range, in-place on the
// parsed manifest. Throws (fail-closed) if a sibling version is unknown.
export function rewriteWorkspaceDeps(
  manifest: Record<string, unknown>,
  versionMap: Map<string, string>,
): boolean {
  let changed = false
  for (const field of DEP_FIELDS) {
    const deps = manifest[field] as Record<string, unknown> | undefined
    if (!deps || typeof deps !== "object") continue
    for (const [dep, spec] of Object.entries(deps)) {
      if (typeof spec !== "string" || !spec.startsWith(WORKSPACE_PREFIX)) continue
      const version = versionMap.get(dep)
      if (!version) {
        throw new Error(
          `${dep} is "${spec}" but no workspace version is known for it (fail-closed)`,
        )
      }
      deps[dep] = resolveWorkspaceRange(spec, version)
      changed = true
    }
  }
  return changed
}

function isE404(r: CmdResult): boolean {
  try {
    const parsed = JSON.parse(r.stdout)
    if (parsed?.error?.code === "E404") return true
  } catch {
    // not JSON; fall through to text scan
  }
  return /\bE404\b/.test(r.stderr) || /\bE404\b/.test(r.stdout)
}

export type PublishDecision = "published" | "publish"

// Decides whether `name@version` must be published. Fail-closed: any registry error
// that is not a clean "package does not exist" (E404) throws rather than guessing.
export function publishDecision(run: Runner, name: string, version: string): PublishDecision {
  const r = run("npm", ["view", name, "versions", "--json"])
  if (r.status === 0) {
    let versions: unknown
    try {
      versions = JSON.parse(r.stdout || "[]")
    } catch {
      throw new Error(`Cannot parse \`npm view ${name} versions\` output: ${r.stdout}`)
    }
    const list = Array.isArray(versions) ? versions : [versions]
    return list.includes(version) ? "published" : "publish"
  }
  if (isE404(r)) return "publish" // package has never been published at all
  throw new Error(
    `\`npm view ${name}\` failed and it is not a clean E404 — refusing to skip or blind-publish ` +
      `(fail-closed). status=${r.status}\n${r.stderr || r.stdout}`,
  )
}

export function discoverPackages(root: string): PkgInfo[] {
  const pkgsDir = join(root, "packages")
  const out: PkgInfo[] = []
  for (const entry of readdirSync(pkgsDir)) {
    const dir = join(pkgsDir, entry)
    let raw: string
    try {
      raw = readFileSync(join(dir, "package.json"), "utf8")
    } catch {
      continue
    }
    const pj = JSON.parse(raw)
    if (pj.private) continue
    out.push({ name: pj.name, version: pj.version, dir })
  }
  return out
}

// Packs the (already-rewritten) package and asserts no `workspace:` survived into the tarball.
function assertNoWorkspaceLeak(run: Runner, pkg: PkgInfo): void {
  const r = run("npm", ["pack", "--json"], { cwd: pkg.dir })
  if (r.status !== 0) {
    throw new Error(`npm pack failed for ${pkg.name}: ${r.stderr || r.stdout}`)
  }
  const filename: string = JSON.parse(r.stdout)[0].filename
  const tgz = join(pkg.dir, filename)
  const tmp = mkdtempSync(join(tmpdir(), "tskm-pack-"))
  try {
    const x = run("tar", ["-xzf", tgz, "-C", tmp, "package/package.json"])
    if (x.status !== 0) throw new Error(`tar extract failed for ${filename}: ${x.stderr}`)
    const packed = readFileSync(join(tmp, "package", "package.json"), "utf8")
    if (packed.includes(WORKSPACE_PREFIX)) {
      throw new Error(`\`workspace:\` protocol leaked into ${filename} — aborting publish`)
    }
  } finally {
    rmSync(tgz, { force: true })
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function publishOne(
  run: Runner,
  pkg: PkgInfo,
  versionMap: Map<string, string>,
  opts: { dryRun: boolean },
): void {
  const ref = `${pkg.name}@${pkg.version}`
  if (publishDecision(run, pkg.name, pkg.version) === "published") {
    console.log(`• skip   ${ref} (already on registry)`)
    return
  }

  const pjPath = join(pkg.dir, "package.json")
  const original = readFileSync(pjPath, "utf8")
  const manifest = JSON.parse(original)
  const changed = rewriteWorkspaceDeps(manifest, versionMap)
  if (changed) writeFileSync(pjPath, `${JSON.stringify(manifest, null, 2)}\n`)
  try {
    assertNoWorkspaceLeak(run, pkg)
    if (opts.dryRun) {
      console.log(`• PUBLISH ${ref} (dry-run: validated, not published)`)
      return
    }
    const r = run("npm", ["publish"], { cwd: pkg.dir })
    if (r.status !== 0) {
      throw new Error(`npm publish failed for ${ref}: ${r.stderr || r.stdout}`)
    }
    console.log(`• PUBLISH ${ref} ✓`)
  } finally {
    if (changed) writeFileSync(pjPath, original) // restore the workspace: source form
  }
}

export const realRunner: Runner = (cmd, args, opts) => {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts?.cwd ?? process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { status: 0, stdout, stderr: "" }
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string }
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? String(e),
    }
  }
}

export function run(argv: string[], runner: Runner = realRunner): void {
  const dryRun = argv.includes("--dry-run")
  const checkOnly = argv.includes("--check")
  const root = process.cwd()
  const pkgs = discoverPackages(root)
  const versionMap = new Map(pkgs.map((p) => [p.name, p.version]))
  const ordered: PkgInfo[] = []
  for (const name of PUBLISH_ORDER) {
    const found = pkgs.find((p) => p.name === name)
    if (!found) throw new Error(`Expected publishable package ${name} not found under packages/`)
    ordered.push(found)
  }

  // --check: report (fail-closed) whether any committed version is not yet on the
  // registry, for the release workflow's should_publish gate. Never packs or publishes.
  if (checkOnly) {
    let shouldPublish = false
    for (const pkg of ordered) {
      const decision = publishDecision(runner, pkg.name, pkg.version)
      if (decision === "publish") shouldPublish = true
      console.log(
        `• ${decision === "publish" ? "needs publish" : "up to date "} ${pkg.name}@${pkg.version}`,
      )
    }
    console.log(`should_publish=${shouldPublish}`)
    const out = process.env.GITHUB_OUTPUT
    if (out) appendFileSync(out, `should_publish=${shouldPublish}\n`)
    return
  }

  console.log(
    `${dryRun ? "DRY-RUN " : ""}publishing ${ordered.length} packages in order: ${PUBLISH_ORDER.join(" → ")}`,
  )
  for (const pkg of ordered) publishOne(runner, pkg, versionMap, { dryRun })
}

if (import.meta.main) {
  run(process.argv.slice(2))
}
