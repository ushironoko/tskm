// Clean-room install + run smoke test for the packed tarballs.
//
// Every other gate (publint / attw / dry-run) runs inside the workspace, where
// `@tskm/vite -> @tskm/compiler` is a `workspace:*` symlink and peer deps are
// dev-installed — so they cannot catch a package that is broken only AFTER a real
// `npm install` from the published tarball. This packs all three packages, installs
// them with their REAL peers into a throwaway project outside the workspace, and
// exercises the public entry points, the `tskm` bin, and the spawned worker file.
//
// Run AFTER `bun run build`. Requires network (registry deps + peers).

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverPackages, type PkgInfo, rewriteWorkspaceDeps } from "./publish.ts"

function sh(cmd: string, args: string[], cwd: string): void {
  execFileSync(cmd, args, { cwd, stdio: "inherit" })
}

// Packs one package (with `workspace:` deps rewritten to concrete ranges, then
// restored) into destDir and returns the absolute tarball path.
function packPackage(pkg: PkgInfo, versionMap: Map<string, string>, destDir: string): string {
  const pjPath = join(pkg.dir, "package.json")
  const original = readFileSync(pjPath, "utf8")
  const manifest = JSON.parse(original)
  const changed = rewriteWorkspaceDeps(manifest, versionMap)
  if (changed) writeFileSync(pjPath, `${JSON.stringify(manifest, null, 2)}\n`)
  try {
    const out = execFileSync("npm", ["pack", "--json", "--pack-destination", destDir], {
      cwd: pkg.dir,
      encoding: "utf8",
    })
    const filename: string = JSON.parse(out)[0].filename
    return join(destDir, filename)
  } finally {
    if (changed) writeFileSync(pjPath, original)
  }
}

const CHECKS: Record<string, string> = {
  // tskm: zero-dependency library — a known named export must be callable.
  "check-tskm.mjs":
    "import * as m from 'tskm'; if (typeof m.email !== 'function') { throw new Error('tskm: expected named export `email` to be a function'); } console.log('tskm import OK');",
  // @tskm/compiler: a known named export must be present after install from the tarball.
  "check-compiler.mjs":
    "import * as m from '@tskm/compiler'; if (typeof m.defineConfig !== 'function') { throw new Error('@tskm/compiler: expected `defineConfig` export'); } console.log('@tskm/compiler import OK');",
  // @tskm/vite: the plugin factory must be exported.
  "check-vite.mjs":
    "import * as m from '@tskm/vite'; if (typeof m.tskm !== 'function') { throw new Error('@tskm/vite: expected `tskm` plugin export'); } console.log('@tskm/vite import OK');",
}

function main(): void {
  const root = process.cwd()
  const pkgs = discoverPackages(root)
  const versionMap = new Map(pkgs.map((p) => [p.name, p.version]))

  for (const pkg of pkgs) {
    if (!existsSync(join(pkg.dir, "dist"))) {
      throw new Error(`${pkg.name} has no dist/ — run \`bun run build\` before the smoke test`)
    }
  }

  const compiler = pkgs.find((p) => p.name === "@tskm/compiler")
  if (!compiler) throw new Error("@tskm/compiler not found")
  const vite = pkgs.find((p) => p.name === "@tskm/vite")
  if (!vite) throw new Error("@tskm/vite not found")

  // Pin peers to the versions the repo develops against.
  const nativePreview = JSON.parse(readFileSync(join(compiler.dir, "package.json"), "utf8"))
    .devDependencies["@typescript/native-preview"]
  const viteVersion = JSON.parse(readFileSync(join(vite.dir, "package.json"), "utf8"))
    .devDependencies.vite

  const packDir = mkdtempSync(join(tmpdir(), "tskm-smoke-pack-"))
  const consumer = mkdtempSync(join(tmpdir(), "tskm-smoke-consumer-"))
  try {
    const tarballs = new Map<string, string>()
    for (const pkg of pkgs) tarballs.set(pkg.name, packPackage(pkg, versionMap, packDir))

    const consumerPkg = {
      name: "tskm-smoke-consumer",
      private: true,
      type: "module",
      dependencies: {
        tskm: `file:${tarballs.get("tskm")}`,
        "@tskm/compiler": `file:${tarballs.get("@tskm/compiler")}`,
        "@tskm/vite": `file:${tarballs.get("@tskm/vite")}`,
        "@typescript/native-preview": nativePreview,
        vite: viteVersion,
      },
      // Force @tskm/vite's compiler dependency to resolve to our local tarball
      // (it is not on the registry yet during a pre-publish smoke).
      overrides: { "@tskm/compiler": `file:${tarballs.get("@tskm/compiler")}` },
    }
    writeFileSync(join(consumer, "package.json"), `${JSON.stringify(consumerPkg, null, 2)}\n`)
    for (const [file, body] of Object.entries(CHECKS)) writeFileSync(join(consumer, file), body)

    console.log("• installing packed tarballs + real peers into a clean project…")
    sh("npm", ["install", "--no-audit", "--no-fund"], consumer)

    // 1) public entry points resolve and export the expected surface
    for (const file of Object.keys(CHECKS)) sh("node", [file], consumer)

    // 2) the `tskm` bin runs (shebang + install layout + peer present)
    console.log("• running the tskm bin (--help)…")
    sh(join(consumer, "node_modules", ".bin", "tskm"), ["--help"], consumer)

    // 3) the spawned worker file actually ships and is resolvable from node_modules
    //    (it is loaded by path at runtime, not imported — a classic publish-only break)
    const worker = join(
      consumer,
      "node_modules",
      "@tskm",
      "compiler",
      "dist",
      "jsonschema-worker.mjs",
    )
    if (!existsSync(worker)) {
      throw new Error(
        `@tskm/compiler is missing dist/jsonschema-worker.mjs in the installed layout`,
      )
    }
    console.log("• worker file present in installed layout OK")

    console.log("\n✓ clean-room smoke passed")
  } finally {
    rmSync(packDir, { recursive: true, force: true })
    rmSync(consumer, { recursive: true, force: true })
  }
}

main()
