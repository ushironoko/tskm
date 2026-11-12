// Clean-room install + run smoke test for the packed tarballs.
//
// Every other gate (publint / attw / dry-run) runs inside the workspace, where
// `@tskm/vite -> @tskm/compiler` is a `workspace:*` symlink and peer deps are
// dev-installed — so they cannot catch a package that is broken only AFTER a real
// `npm install` from the published tarball. This packs all three packages, installs
// them with their REAL peers into a throwaway project outside the workspace, and
// exercises the public entry points, the `tskm` bin, and the spawned worker file.
//
// It also runs `tskm gen` with `jsonSchema.emit: "standard"` against those tarballs.
// The first npm publish of static Standard JSON Schema has to fail here when the
// packed compiler omits the sidecar literal, or when `withStaticJsonSchema` from the
// packed `@tskm/core/json-schema` does not serve it. A second project proves the
// fail-closed bigint path: `tskm gen` exits 1 and does not leave the previous const.
//
// Run AFTER `bun run build`. Requires network (registry deps + peers).

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { discoverPackages, type PkgInfo, rewriteWorkspaceDeps } from "./publish.ts"

function sh(cmd: string, args: string[], cwd: string): void {
  execFileSync(cmd, args, { cwd, stdio: "inherit" })
}

/** Like {@link sh}, but returns the exit status instead of throwing on non-zero. */
function run(cmd: string, args: string[], cwd: string): number {
  try {
    execFileSync(cmd, args, { cwd, stdio: "inherit" })
    return 0
  } catch (error) {
    const status =
      error !== null && typeof error === "object" && "status" in error ? error.status : undefined
    if (typeof status === "number") return status
    throw error
  }
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

function writeProjectFile(dir: string, rel: string, body: string): void {
  const path = join(dir, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}

const CHECKS: Record<string, string> = {
  // tskm: zero-dependency library — a known named export must be callable.
  "check-tskm.mjs":
    "import * as m from '@tskm/core'; if (typeof m.email !== 'function') { throw new Error('tskm: expected named export `email` to be a function'); } console.log('tskm import OK');",
  // @tskm/compiler: a known named export must be present after install from the tarball.
  "check-compiler.mjs":
    "import * as m from '@tskm/compiler'; if (typeof m.defineConfig !== 'function') { throw new Error('@tskm/compiler: expected `defineConfig` export'); } console.log('@tskm/compiler import OK');",
  // @tskm/vite: the plugin factory must be exported.
  "check-vite.mjs":
    "import * as m from '@tskm/vite'; if (typeof m.tskm !== 'function') { throw new Error('@tskm/vite: expected `tskm` plugin export'); } console.log('@tskm/vite import OK');",
  // @tskm/core/json-schema: the static wrapper must resolve from the packed export.
  "check-json-schema.mjs":
    "import { withStaticJsonSchema } from '@tskm/core/json-schema'; if (typeof withStaticJsonSchema !== 'function') { throw new Error('@tskm/core/json-schema: expected `withStaticJsonSchema` to be a function'); } console.log('@tskm/core/json-schema import OK');",
}

// Consumer tsconfig. No `paths`: Node and the worker resolve `@tskm/core` from
// node_modules only. `include` is the checker project; tskm's own include is the config.
const STATIC_TSCONFIG = `{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
`

// `include` stops at `src/`, matching examples/integrations. A module under `shared/`
// is not a schema source, so generating the sidecar does not load it.
const STATIC_CONFIG = `import { defineConfig } from "@tskm/compiler"

export default defineConfig({
  include: ["src/**/*.ts"],
  jsonSchema: { emit: "standard" },
})
`

// Schema source. Must not import the sidecar: `tskm gen` loads this file to build
// the literals, and an import of `*.gen.ts` would import the file it is writing.
const USER_SCHEMA = `import { email, minLength, number, object, pipe, string } from "@tskm/core"

export const userSchema = object({
  name: pipe(string(), minLength(1)),
  email: pipe(string(), email()),
  age: number(),
})
`

const STATIC_USER = `import { withStaticJsonSchema } from "@tskm/core/json-schema"
import { userSchemaJsonSchema } from "../src/user.schema.gen.ts"
import { userSchema } from "../src/user.schema.ts"

export const staticUserSchema = withStaticJsonSchema(userSchema, userSchemaJsonSchema)
`

// Runs after `tskm gen`. The wrapper call lives in `shared/`, outside `include`.
const CHECK_STATIC = `import { strict as assert } from "node:assert"
import { withJsonSchema } from "@tskm/core/json-schema"
import { staticUserSchema } from "./shared/static-user.ts"
import { userSchemaJsonSchema } from "./src/user.schema.gen.ts"
import { userSchema } from "./src/user.schema.ts"

const literal = userSchemaJsonSchema["draft-07"]?.input
if (literal === undefined) {
  throw new Error("sidecar userSchemaJsonSchema is missing draft-07 input")
}
const wrapped = staticUserSchema["~standard"].jsonSchema.input({ target: "draft-07" })
if (wrapped !== literal) {
  throw new Error("withStaticJsonSchema did not return the sidecar draft-07 input document")
}
assert.deepEqual(
  wrapped,
  withJsonSchema(userSchema)["~standard"].jsonSchema.input({ target: "draft-07" }),
)
console.log("static Standard JSON Schema draft-07 input matches withJsonSchema OK")
`

const REPRESENTABLE_SCHEMA = `import { string } from "@tskm/core"

export const userSchema = string()
`

const BIGINT_SCHEMA = `import { bigint } from "@tskm/core"

export const userSchema = bigint()
`

function writeStaticProject(dir: string, schemaSource: string): void {
  writeProjectFile(dir, "tsconfig.json", STATIC_TSCONFIG)
  writeProjectFile(dir, "tskm.config.ts", STATIC_CONFIG)
  writeProjectFile(dir, "src/user.schema.ts", schemaSource)
}

/**
 * Happy path: `tskm gen` writes `userSchemaJsonSchema`, and the module outside
 * `include` serves that literal through `withStaticJsonSchema`. The schema source
 * does not import the sidecar, so this first gen has nothing to load from `shared/`.
 */
function checkStaticEmit(consumer: string, tskmBin: string): void {
  const dir = join(consumer, "static-json")
  writeStaticProject(dir, USER_SCHEMA)
  writeProjectFile(dir, "shared/static-user.ts", STATIC_USER)
  writeProjectFile(dir, "check-static.mjs", CHECK_STATIC)

  const schemaSource = readFileSync(join(dir, "src/user.schema.ts"), "utf8")
  if (schemaSource.includes(".gen") || schemaSource.includes("withStaticJsonSchema")) {
    throw new Error(
      "static smoke fixture: schema source must not import the sidecar or withStaticJsonSchema",
    )
  }

  console.log("• tskm gen with jsonSchema.emit standard…")
  const status = run(tskmBin, ["gen"], dir)
  if (status !== 0) {
    throw new Error(`tskm gen (jsonSchema.emit standard) exited ${status}`)
  }

  const genPath = join(dir, "src/user.schema.gen.ts")
  const gen = readFileSync(genPath, "utf8")
  if (!gen.includes("userSchemaJsonSchema")) {
    throw new Error("sidecar is missing userSchemaJsonSchema after tskm gen")
  }
  sh("node", ["check-static.mjs"], dir)
}

/**
 * Fail-closed bigint, in its own directory so it cannot replace the happy-path
 * sidecar. The first gen writes a real const; the second must exit 1 and drop it.
 * A rewrite that keeps the previous literal fails this check.
 */
function checkStaticFailClosed(consumer: string, tskmBin: string): void {
  const dir = join(consumer, "fail-closed")
  writeStaticProject(dir, REPRESENTABLE_SCHEMA)

  console.log("• tskm gen (representable schema, so a static const exists)…")
  const setup = run(tskmBin, ["gen"], dir)
  if (setup !== 0) {
    throw new Error(`tskm gen (representable schema) exited ${setup}`)
  }
  const genPath = join(dir, "src/user.schema.gen.ts")
  const before = readFileSync(genPath, "utf8")
  if (!before.includes("userSchemaJsonSchema")) {
    throw new Error(
      "setup gen did not emit userSchemaJsonSchema; cannot prove a stale const is removed",
    )
  }

  writeProjectFile(dir, "src/user.schema.ts", BIGINT_SCHEMA)
  console.log("• tskm gen (bigint, expect exit 1 and no static const)…")
  const status = run(tskmBin, ["gen"], dir)
  if (status !== 1) {
    throw new Error(`tskm gen (bigint) exited ${status}; expected 1`)
  }
  const after = existsSync(genPath) ? readFileSync(genPath, "utf8") : ""
  if (after.includes("userSchemaJsonSchema") || after.includes("as const")) {
    throw new Error(
      "bigint schema: tskm gen exited 1 but left a static JSON Schema const in the sidecar",
    )
  }
  console.log("• bigint fail-closed: exit 1 and no static const left behind OK")
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
  const typescriptVersion = JSON.parse(readFileSync(join(compiler.dir, "package.json"), "utf8"))
    .devDependencies.typescript
  const viteVersion = JSON.parse(readFileSync(join(vite.dir, "package.json"), "utf8"))
    .devDependencies.vite

  const packDir = mkdtempSync(join(tmpdir(), "tskm-smoke-pack-"))
  const consumer = mkdtempSync(join(tmpdir(), "tskm-smoke-consumer-"))
  try {
    const tarballs = new Map<string, string>()
    for (const pkg of pkgs) tarballs.set(pkg.name, packPackage(pkg, versionMap, packDir))

    // The packed @tskm/vite has `@tskm/compiler: workspace:*` rewritten to
    // `^<compiler version>` (packPackage -> rewriteWorkspaceDeps), and the three
    // packages are released in lockstep at the same version. So the top-level
    // `@tskm/compiler` file: tarball installs a version that satisfies that `^` range,
    // and npm dedupes to it without reaching the registry — no override needed.
    const consumerPkg = {
      name: "tskm-smoke-consumer",
      private: true,
      type: "module",
      dependencies: {
        "@tskm/core": `file:${tarballs.get("@tskm/core")}`,
        "@tskm/compiler": `file:${tarballs.get("@tskm/compiler")}`,
        "@tskm/vite": `file:${tarballs.get("@tskm/vite")}`,
        typescript: typescriptVersion,
        vite: viteVersion,
      },
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

    // 4) static Standard JSON Schema from the packed tarballs
    const tskmBin = join(consumer, "node_modules", ".bin", "tskm")
    checkStaticEmit(consumer, tskmBin)
    checkStaticFailClosed(consumer, tskmBin)

    console.log("\n✓ clean-room smoke passed")
  } finally {
    rmSync(packDir, { recursive: true, force: true })
    rmSync(consumer, { recursive: true, force: true })
  }
}

main()
