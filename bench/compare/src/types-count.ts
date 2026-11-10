import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { type LibraryName, typeCopies } from "./config.ts"

export interface TypeRow {
  readonly library: LibraryName
  readonly checker: "tsc" | "tsgo"
  readonly instantiations: number
  readonly checkTimeMs: number
}

// Both checkers are devDependencies of this package at exact versions (see package.json).
// They are not taken from the repository root, which does not install tsgo.
const benchRoot = new URL("../", import.meta.url)
const tsc = new URL("node_modules/typescript/lib/tsc.js", benchRoot)
const tsgo = new URL("node_modules/@typescript/native-preview/bin/tsgo", benchRoot)

const expressions: Record<
  LibraryName,
  { readonly imports: string; readonly body: string; readonly typeOf: string }
> = {
  tskm: {
    imports: `import { array, boolean, email, integer, maxLength, maxValue, minLength, minValue, number, object, picklist, pipe, string, type InferOutput } from "../../../../packages/tskm/dist/index.mjs"`,
    body: `object({
  id: pipe(number(), integer(), minValue(1)),
  name: pipe(string(), minLength(1), maxLength(100)),
  email: pipe(string(), minLength(3), maxLength(100), email()),
  role: picklist(["admin", "member", "guest"]),
  tags: array(pipe(string(), minLength(1), maxLength(30))),
  active: boolean(),
  score: pipe(number(), integer(), minValue(0), maxValue(100)),
  address: object({
    city: pipe(string(), minLength(1), maxLength(50)),
    zip: pipe(string(), minLength(1), maxLength(12)),
  }),
})`,
    typeOf: "InferOutput<typeof sINDEX>",
  },
  zod: {
    imports: `import * as z from "zod"`,
    body: `z.object({
  id: z.number().int().min(1),
  name: z.string().min(1).max(100),
  email: z.email().min(3).max(100),
  role: z.enum(["admin", "member", "guest"]),
  tags: z.array(z.string().min(1).max(30)),
  active: z.boolean(),
  score: z.number().int().min(0).max(100),
  address: z.object({
    city: z.string().min(1).max(50),
    zip: z.string().min(1).max(12),
  }),
})`,
    typeOf: "z.infer<typeof sINDEX>",
  },
  valibot: {
    imports: `import * as v from "valibot"`,
    body: `v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  email: v.pipe(v.string(), v.minLength(3), v.maxLength(100), v.email()),
  role: v.picklist(["admin", "member", "guest"]),
  tags: v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(30))),
  active: v.boolean(),
  score: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)),
  address: v.object({
    city: v.pipe(v.string(), v.minLength(1), v.maxLength(50)),
    zip: v.pipe(v.string(), v.minLength(1), v.maxLength(12)),
  }),
})`,
    typeOf: "v.InferOutput<typeof sINDEX>",
  },
  arktype: {
    imports: `import { type } from "arktype"`,
    body: `type({
  id: "number.integer >= 1",
  name: "1 <= string <= 100",
  email: "string.email",
  role: "'admin' | 'member' | 'guest'",
  tags: "(1 <= string <= 30)[]",
  active: "boolean",
  score: "0 <= number.integer <= 100",
  address: {
    city: "1 <= string <= 50",
    zip: "1 <= string <= 12",
  },
})`,
    typeOf: "typeof sINDEX.infer",
  },
  typebox: {
    imports: `import { Type, type Static } from "typebox"`,
    body: `Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  email: Type.String({ format: "email", minLength: 3, maxLength: 100 }),
  role: Type.Union([Type.Literal("admin"), Type.Literal("member"), Type.Literal("guest")]),
  tags: Type.Array(Type.String({ minLength: 1, maxLength: 30 })),
  active: Type.Boolean(),
  score: Type.Integer({ minimum: 0, maximum: 100 }),
  address: Type.Object({
    city: Type.String({ minLength: 1, maxLength: 50 }),
    zip: Type.String({ minLength: 1, maxLength: 12 }),
  }),
})`,
    typeOf: "Static<typeof sINDEX>",
  },
  effect: {
    imports: `import * as Schema from "effect/Schema"`,
    body: `Schema.Struct({
  id: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  name: Schema.String.check(Schema.isBetweenLength(1, 100)),
  email: Schema.String.check(Schema.isBetweenLength(3, 100), Schema.isPattern(/^[\\w+-]+(?:\\.[\\w+-]+)*@[\\da-z]+(?:[.-][\\da-z]+)*\\.[a-z]{2,}$/i)),
  role: Schema.Literals(["admin", "member", "guest"]),
  tags: Schema.Array(Schema.String.check(Schema.isBetweenLength(1, 30))),
  active: Schema.Boolean,
  score: Schema.Finite.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 100 })),
  address: Schema.Struct({
    city: Schema.String.check(Schema.isBetweenLength(1, 50)),
    zip: Schema.String.check(Schema.isBetweenLength(1, 12)),
  }),
})`,
    typeOf: '(typeof sINDEX)["Type"]',
  },
}

function sourceFor(name: LibraryName): string {
  const spec = expressions[name]
  const lines = [spec.imports, ""]
  for (let i = 0; i < typeCopies; i++) {
    lines.push(`export const s${i} = ${spec.body}`)
    lines.push(`export type T${i} = ${spec.typeOf.replaceAll("INDEX", String(i))}`)
  }
  lines.push("")
  return lines.join("\n")
}

function writeFixture(name: LibraryName): URL {
  const dir = new URL(`../fixtures/${name}/`, import.meta.url)
  mkdirSync(dir, { recursive: true })
  writeFileSync(new URL("schemas.ts", dir), sourceFor(name))
  writeFileSync(
    new URL("tsconfig.json", dir),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: [],
          allowImportingTsExtensions: true,
        },
        files: ["schemas.ts"],
      },
      null,
      2,
    ),
  )
  return dir
}

/** Reads one `--extendedDiagnostics` line. `Check time` is printed in seconds ("0.27s") or
 * milliseconds ("270ms") depending on the checker; every other value is a plain integer. */
function readDiagnostic(text: string, label: string): number {
  const line = text.split("\n").find((entry) => entry.trimStart().startsWith(`${label}:`))
  if (!line) throw new Error(`missing ${label}\n${text}`)
  const raw = line
    .slice(line.indexOf(":") + 1)
    .trim()
    .replaceAll(",", "")
  if (label === "Check time") {
    const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(raw)
    if (!match) throw new Error(`bad ${label}: ${line}`)
    return Number(match[1]) * (match[2] === "s" ? 1000 : 1)
  }
  if (!/^\d+$/.test(raw)) throw new Error(`bad ${label}: ${line}`)
  return Number(raw)
}

function runChecker(command: string, args: string[], cwd: string): string {
  const child = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (child.error) throw new Error(`${command} could not be started: ${child.error.message}`)
  const text = `${child.stdout}\n${child.stderr}`
  // A fixture with type errors exits non-zero, so a broken copy fails the run instead of
  // producing a count for a partly-checked program.
  if (child.status !== 0) {
    throw new Error(`${command} exited with ${child.status} in ${cwd}\n${text}`)
  }
  return text
}

export function measureTypes(name: LibraryName): readonly TypeRow[] {
  const dir = writeFixture(name)
  const cwd = dir.pathname
  const flags = ["-p", "tsconfig.json", "--extendedDiagnostics", "--pretty", "false"]
  const tscText = runChecker(process.execPath, [tsc.pathname, ...flags], cwd)
  const tsgoText = runChecker(tsgo.pathname, flags, cwd)
  return [
    {
      library: name,
      checker: "tsc",
      instantiations: readDiagnostic(tscText, "Instantiations"),
      checkTimeMs: readDiagnostic(tscText, "Check time"),
    },
    {
      library: name,
      checker: "tsgo",
      instantiations: readDiagnostic(tsgoText, "Instantiations"),
      checkTimeMs: readDiagnostic(tsgoText, "Check time"),
    },
  ]
}
