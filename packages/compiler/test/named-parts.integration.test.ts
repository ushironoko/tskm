import { afterAll, describe, expect, it } from "bun:test"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"
import { referenceNamedParts } from "../src/named-parts.ts"
import { withTestTsgo } from "./tsgo-test-executable.ts"
import { runTsgoNoEmit } from "./typecheck-harness.ts"

// End-to-end for named object parts (see src/named-parts.ts): real discovery, the checker, emit,
// and the real tsgo `--noEmit` over the generated files plus a type-level equality probe. Every
// alias must be type-identical to the schema it came from, so the named form is only a shorter
// spelling of the same type.

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const parts = fixture("named-parts")
const cross = fixture("named-parts-cross")
const reserved = fixture("named-parts-reserved")
const cycle = fixture("named-parts-cycle")
const inplace = fixture("named-parts-inplace")
const repeated = fixture("named-parts-repeated")
/** The `@tskm/core` entry by absolute path: a copied fixture cannot use the relative one. */
const coreIndex = fileURLToPath(new URL("../../tskm/src/index.ts", import.meta.url))

const EQUAL =
  "type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false"

/** Writes a probe file into the fixture's `src/`; `clean` removes it again. */
function writeProbe(root: string, file: string, lines: ReadonlyArray<string>): void {
  writeFileSync(`${root}/src/${file}`, `${lines.join("\n")}\n`)
}

/** Removes the generated sidecars, query leftovers, and probes from a fixture's `src/`. */
function clean(root: string): void {
  for (const file of readdirSync(`${root}/src`)) {
    if (/\.(gen|tskm-query)\.ts$|\.check\.ts$/.test(file)) {
      rmSync(`${root}/src/${file}`, { force: true })
    }
  }
}

afterAll(() => {
  for (const root of [parts, cross, reserved, cycle, repeated]) {
    clean(root)
  }
})

/**
 * A throwaway copy of a fixture's `src/` and tsconfig in the OS temp directory. A test that rewrites
 * its source runs on the copy, so a killed run cannot leave the committed fixture modified. The copy
 * points `@tskm/core` at the same module by absolute path, because the fixture's relative path only
 * resolves from inside the repository.
 */
function copyFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `tskm-${name}-`))
  cpSync(`${fixture(name)}/src`, `${root}/src`, { recursive: true })
  const tsconfig = JSON.parse(readFileSync(`${fixture(name)}/tsconfig.json`, "utf8")) as {
    compilerOptions: { paths: Record<string, string[]> }
  }
  tsconfig.compilerOptions.paths["@tskm/core"] = [coreIndex]
  writeFileSync(`${root}/tsconfig.json`, `${JSON.stringify(tsconfig, null, 2)}\n`)
  return root
}

function generateAll(root: string) {
  return generate({
    root,
    config: withTestTsgo({
      mode: "sidecar",
      include: ["src/*.schema.ts"],
      tsconfig: "tsconfig.json",
    }),
  })
}

const read = (root: string, file: string): string => readFileSync(`${root}/src/${file}`, "utf8")

/**
 * Deterministic random bodies for the `Equal` fuzz: objects, unions, intersections, arrays, tuples,
 * and function types, built from a small pool so shared objects and unions repeat on purpose.
 */
function randomBodies(seed: number, count: number): Array<{ typeName: string; body: string }> {
  let state = seed >>> 0
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
  const KEYS = ["a", "b", "c"]
  const PRIMS = ["string", "number", '"x"', '"a|b"']
  const objects: string[] = []
  const unions: string[] = []
  const obj = (depth: number): string => {
    if (objects.length > 0 && random() < 0.45) {
      return pick(objects)
    }
    const used = new Set<string>()
    const members: string[] = []
    for (let i = 0, n = 1 + Math.floor(random() * 2); i < n; i++) {
      const key = pick(KEYS)
      if (!used.has(key)) {
        used.add(key)
        members.push(`${key}: ${ty(depth + 1)}; `)
      }
    }
    const text = `{ ${members.join("")}}`
    objects.push(text)
    return text
  }
  const union = (depth: number): string => {
    if (unions.length > 0 && random() < 0.3) {
      return pick(unions)
    }
    const parts = Array.from({ length: 2 + Math.floor(random() * 2) }, () =>
      random() < 0.7 ? obj(depth + 1) : pick(PRIMS),
    )
    const text = parts.join(" | ")
    if (parts.every((part) => part.startsWith("{"))) {
      unions.push(text)
    }
    return text
  }
  const ty = (depth: number): string => {
    const r = random()
    if (depth > 2 || r < 0.2) return pick(PRIMS)
    if (r < 0.45) return obj(depth)
    if (r < 0.6) return union(depth)
    if (r < 0.72) {
      // An intersection whose operand may be a parenthesized union, as the walker prints it.
      return `${random() < 0.5 ? obj(depth + 1) : `(${union(depth + 1)})`} & ${obj(depth + 1)}`
    }
    if (r < 0.78) return `(${union(depth + 1)})[]`
    if (r < 0.84) {
      // Tuples, arrays, and type arguments often repeat one element: TypeScript merges those repeats.
      const element = random() < 0.6 ? obj(depth + 1) : ty(depth + 1)
      return random() < 0.5 ? `[${element}, ${element}]` : `Array<${element}> | Array<${element}>`
    }
    if (r < 0.9) return `[${ty(depth + 1)}, ${ty(depth + 1)}]`
    return `(x: ${ty(depth + 1)}) => ${union(depth + 1)}`
  }
  return Array.from({ length: count }, (_, i) => {
    const r = random()
    const body = r < 0.3 ? obj(0) : r < 0.5 ? union(0) : ty(0)
    return { typeName: `S${i}`, body }
  })
}

describe("named object parts (real checker)", () => {
  it("references a shared object part by its alias name, at every use site", async () => {
    clean(parts)
    const result = await generateAll(parts)
    expect(result.diagnostics).toEqual([
      'tskm: duplicate generated type name "User" (exports "user" and "userSchema"); skipping the later declaration. Existing output left untouched.',
    ])
    const gen = read(parts, "parts.schema.gen.ts")

    // A part directly, under an optional wrapper, and as an array element.
    expect(gen).toContain("  address: Address;")
    expect(gen).toContain("  home: Address | undefined;")
    expect(gen).toContain("  contacts: Contact[];")
    // A discriminated union with inline members is named where it is used.
    expect(gen).toContain("  shape: Shape;")
    expect(gen).toContain("  backup: Shape;")
    // Two exports with the same body: the first declaration is the one referenced.
    expect(gen).toContain("  billing: Address;")
    expect(gen).toContain("  ship: Address;")
    // The declared aliases are still emitted once each.
    expect(gen.match(/^export type Address = /gm)?.length).toBe(1)
    expect(gen.match(/^export type Shape = /gm)?.length).toBe(1)
  }, 60_000)

  it("regenerating reproduces the committed snapshot byte for byte", async () => {
    clean(parts)
    await generateAll(parts)
    // After an intended output change, copy the generated file over `expected/` and review it.
    expect(read(parts, "parts.schema.gen.ts")).toBe(
      readFileSync(`${parts}/expected/parts.schema.gen.txt`, "utf8"),
    )
  }, 60_000)

  it("every alias is type-identical to its schema under real tsgo", async () => {
    clean(parts)
    await generateAll(parts)
    writeProbe(parts, "parts.check.ts", [
      `import type { Infer } from "@tskm/core"`,
      `import type { Account, Address, BillingAddress, Contact, Drawing, Order, Profile, Shape, User } from "./parts.schema.gen.ts"`,
      `import type { accountSchema, addressSchema, billingAddressSchema, contactSchema, drawingSchema, orderSchema, profileSchema, shapeSchema, user, userSchema } from "./parts.schema.ts"`,
      EQUAL,
      `export const eqAddress: Equal<Address, Infer<typeof addressSchema>> = true`,
      `export const eqContact: Equal<Contact, Infer<typeof contactSchema>> = true`,
      `export const eqProfile: Equal<Profile, Infer<typeof profileSchema>> = true`,
      `export const eqShape: Equal<Shape, Infer<typeof shapeSchema>> = true`,
      `export const eqDrawing: Equal<Drawing, Infer<typeof drawingSchema>> = true`,
      `export const eqBilling: Equal<BillingAddress, Infer<typeof billingAddressSchema>> = true`,
      `export const eqOrder: Equal<Order, Infer<typeof orderSchema>> = true`,
      `export const eqUser: Equal<User, Infer<typeof user>> = true`,
      `export const eqAccount: Equal<Account, Infer<typeof accountSchema>> = true`,
      // The inline fallback (the dropped `userSchema`) is the same type as its schema too.
      `export const eqAccountBackup: Equal<Account["backup"], Infer<typeof userSchema>> = true`,
      `export const eqShapeInDrawing: Equal<Drawing["shape"], Infer<typeof shapeSchema>> = true`,
    ])
    const check = runTsgoNoEmit(parts)
    expect(check.output).toBe("")
    expect(check.ok).toBe(true)
  }, 120_000)

  it("the equality probe is sensitive: a deliberately different type fails it", async () => {
    clean(parts)
    await generateAll(parts)
    writeProbe(parts, "negative.check.ts", [
      `import type { Address } from "./parts.schema.gen.ts"`,
      EQUAL,
      `export const wrong: Equal<Address, { street: string }> = true`,
    ])
    const check = runTsgoNoEmit(parts)
    expect(check.ok).toBe(false)
    expect(check.output).toContain("error TS2322")
  }, 120_000)

  it("a part from another module stays inline and needs no import (documented fallback)", async () => {
    clean(cross)
    const result = await generateAll(cross)
    expect(result.diagnostics).toEqual([])
    const visit = read(cross, "visit.schema.gen.ts")
    // The address shape is written out, not named, and the sidecar imports nothing.
    expect(visit).toContain("  at: {\n    street: string;\n    city: string;\n  };")
    expect(visit).not.toContain("import")
    expect(visit).not.toContain("Address")

    writeProbe(cross, "visit.check.ts", [
      `import type { Infer } from "@tskm/core"`,
      `import type { Visit } from "./visit.schema.gen.ts"`,
      `import type { visitSchema } from "./visit.schema.ts"`,
      `import type { Address } from "./address.schema.gen.ts"`,
      `import type { addressSchema } from "./address.schema.ts"`,
      EQUAL,
      `export const eqVisit: Equal<Visit, Infer<typeof visitSchema>> = true`,
      `export const eqAddress: Equal<Address, Infer<typeof addressSchema>> = true`,
    ])
    const check = runTsgoNoEmit(cross)
    expect(check.output).toBe("")
    expect(check.ok).toBe(true)
  }, 120_000)

  it("never references a name the sidecar imports: a valibot brand clash stays inline", async () => {
    clean(reserved)
    const result = await generateAll(reserved)
    expect(result.diagnostics).toEqual([])
    const gen = read(reserved, "reserved.schema.gen.ts")
    // Without the guard the valibot body would name `Brand`, which pulls in a valibot import
    // that clashes with the tskm `Brand` alias. With it there is no import and no reference.
    expect(gen).not.toContain("valibot")
    expect(gen).toContain("  owner: {\n    name: string;\n  };")

    writeProbe(reserved, "reserved.check.ts", [
      `import type { Infer } from "@tskm/core"`,
      `import type * as v from "valibot"`,
      `import type { Brand, Pair } from "./reserved.schema.gen.ts"`,
      `import type { brandSchema, pairSchema } from "./reserved.schema.ts"`,
      EQUAL,
      `export const eqBrand: Equal<Brand, Infer<typeof brandSchema>> = true`,
      `export const eqPair: Equal<Pair, v.InferOutput<typeof pairSchema>> = true`,
    ])
    const check = runTsgoNoEmit(reserved)
    expect(check.output).toBe("")
    expect(check.ok).toBe(true)
    expect(existsSync(`${reserved}/src/reserved.schema.tskm-query.ts`)).toBe(false)
  }, 120_000)

  it("a recursive root keeps its cycle guard, and names a shared part it walks", async () => {
    clean(cycle)
    const result = await generate({
      root: cycle,
      config: withTestTsgo({
        mode: "sidecar",
        include: ["src/*.schema.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: process.execPath },
      }),
    })
    expect(result.diagnostics).toEqual([])
    const gen = read(cycle, "cycle.schema.gen.ts")
    // The back-edge is the alias itself, and the shared part is named inside the recursive body.
    expect(gen).toContain("  next: Node[];")
    expect(gen).toContain("  at: Point;")
    expect(gen).toContain("  start: Point;")
    expect(gen).toContain("  end: Point;")

    writeProbe(cycle, "cycle.check.ts", [
      `import type { Infer } from "@tskm/core"`,
      `import type { Node, Point, Route } from "./cycle.schema.gen.ts"`,
      `import type { pointSchema, routeSchema } from "./cycle.schema.ts"`,
      EQUAL,
      `export const eqPoint: Equal<Point, Infer<typeof pointSchema>> = true`,
      `export const eqRoute: Equal<Route, Infer<typeof routeSchema>> = true`,
      `export const eqNode: Equal<Node, { label: string; at: Point; next: Node[] }> = true`,
      // The recursive root is usable as a value of its own type, with its self-reference.
      `export const leaf: Node = { label: "leaf", at: { x: 0, y: 0 }, next: [] }`,
      `export const tree: Node = { label: "root", at: { x: 1, y: 2 }, next: [leaf] }`,
    ])
    const check = runTsgoNoEmit(cycle)
    expect(check.output).toBe("")
    expect(check.ok).toBe(true)
  }, 120_000)

  it("inplace mode names a part by its marker alias in the same file, and type-checks", async () => {
    // Runs on a temp copy: inplace rewrites the source, and the committed fixture must stay pristine.
    const root = copyFixture("named-parts-inplace")
    try {
      const result = await generate({
        root,
        mode: "inplace",
        config: withTestTsgo({ include: ["src/inplace.schema.ts"], tsconfig: "tsconfig.json" }),
      })
      expect(result.diagnostics).toEqual([])
      const written = read(root, "inplace.schema.ts")
      expect(written).toContain("  address: Address;")
      expect(written).toContain("// @tskm-end Profile")

      writeProbe(root, "inplace.check.ts", [
        `import type { Infer } from "@tskm/core"`,
        `import type { Address, Profile } from "./inplace.schema.ts"`,
        `import type { addressSchema, profileSchema } from "./inplace.schema.ts"`,
        EQUAL,
        `export const eqAddress: Equal<Address, Infer<typeof addressSchema>> = true`,
        `export const eqProfile: Equal<Profile, Infer<typeof profileSchema>> = true`,
      ])
      const check = runTsgoNoEmit(root)
      expect(check.output).toBe("")
      expect(check.ok).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)

  it("repeated union operands stay written out, and every alias is strictly identical under real tsgo", async () => {
    clean(repeated)
    const result = await generateAll(repeated)
    expect(result.diagnostics).toEqual([])
    const gen = read(repeated, "repeated.schema.gen.ts")
    // A union of two identical object schemas keeps both members inline (naming them would collapse it).
    expect(gen).toContain("  pair: {\n    a: string;\n  } | {\n    a: string;\n  };")
    // The shared union is named, and a part shared by two properties is named in both.
    expect(gen).toContain("export type Shape = A | B")
    expect(gen).toContain("  left: A;\n  right: A;")

    writeProbe(repeated, "repeated.check.ts", [
      `import type { Infer } from "@tskm/core"`,
      `import type { A, B, Mixed, Pair, Shape, Twin } from "./repeated.schema.gen.ts"`,
      `import type { aSchema, bSchema, mixedSchema, pairSchema, shapeSchema, twinSchema } from "./repeated.schema.ts"`,
      EQUAL,
      `export const eqA: Equal<A, Infer<typeof aSchema>> = true`,
      `export const eqB: Equal<B, Infer<typeof bSchema>> = true`,
      `export const eqShape: Equal<Shape, Infer<typeof shapeSchema>> = true`,
      `export const eqTwin: Equal<Twin, Infer<typeof twinSchema>> = true`,
      `export const eqMixed: Equal<Mixed, Infer<typeof mixedSchema>> = true`,
      `export const eqPair: Equal<Pair, Infer<typeof pairSchema>> = true`,
    ])
    const check = runTsgoNoEmit(repeated)
    expect(check.output).toBe("")
    expect(check.ok).toBe(true)
  }, 120_000)

  it("a repeated operand of a distributed or cross-union group is strictly identical under real tsgo", async () => {
    // Text-level cases the checker never prints as written: a parenthesized union inside an
    // intersection, and two unions that share a member. Each original body is an `Equal` probe
    // against its rewritten alias, so a name that collapses an operand fails here.
    clean(repeated)
    const entries: ReadonlyArray<readonly [string, string]> = [
      ["A", "{ a: string; }"],
      ["B", "{ b: number; }"],
      ["U", "{ a: string; } | { b: number; }"],
      ["V", "{ a: string; } | { c: boolean; }"],
      ["Twin", "{ pair: { a: string; } | { a: string; }; }"],
      ["Both", "{ both: { a: string; } & { a: string; }; }"],
      ["Dist", "{ d: ({ a: string; } | { b: number; }) & { a: string; }; }"],
      ["Flat", "{ f: { a: string; } | { a: string; } | { b: number; }; }"],
      ["Cross", "{ c: ({ a: string; } | { b: number; }) & ({ a: string; } | { c: boolean; }); }"],
      ["Tup", "{ t: [{ a: string; }, { a: string; }]; }"],
      ["Arr", "{ p: { a: string; }[] | { a: string; }[]; }"],
      ["Gen", "{ q: Array<{ a: string; }> | Array<{ a: string; }>; }"],
    ]
    const rewritten = referenceNamedParts(entries.map(([typeName, body]) => ({ typeName, body })))
    // Repeated operands stay inline; a union with a repeated member is not named; the rest is named.
    expect(rewritten.map((entry) => [entry.typeName, entry.body])).toEqual([
      ["A", "{ a: string; }"],
      ["B", "{ b: number; }"],
      ["U", "A | B"],
      ["V", "A | { c: boolean; }"],
      ["Twin", "{ pair: { a: string; } | { a: string; }; }"],
      ["Both", "{ both: { a: string; } & { a: string; }; }"],
      ["Dist", "{ d: ({ a: string; } | B) & { a: string; }; }"],
      ["Flat", "{ f: { a: string; } | { a: string; } | B; }"],
      ["Cross", "{ c: ({ a: string; } | B) & ({ a: string; } | { c: boolean; }); }"],
      ["Tup", "{ t: [{ a: string; }, { a: string; }]; }"],
      ["Arr", "{ p: { a: string; }[] | { a: string; }[]; }"],
      ["Gen", "{ q: Array<{ a: string; }> | Array<{ a: string; }>; }"],
    ])

    writeProbe(repeated, "repeated-text.check.ts", [
      EQUAL,
      ...rewritten.map((entry) => `export type ${entry.typeName} = ${entry.body}`),
      ...entries.map(([typeName, body]) => `type O_${typeName} = ${body}`),
      ...entries.map(
        ([typeName]) => `export const eq${typeName}: Equal<${typeName}, O_${typeName}> = true`,
      ),
    ])
    const check = runTsgoNoEmit(repeated)
    expect(check.output).toBe("")
    expect(check.ok).toBe(true)
    clean(repeated)
  }, 120_000)

  it("random bodies with shared parts stay strictly identical to their originals under real tsgo", async () => {
    clean(repeated)
    const entries = randomBodies(59, 300)
    const rewritten = referenceNamedParts(entries)
    // The pool is built to repeat: most bodies must actually change, or the probe checks nothing.
    expect(rewritten.filter((entry, i) => entry.body !== entries[i]?.body).length).toBeGreaterThan(
      100,
    )
    writeProbe(repeated, "random.check.ts", [
      EQUAL,
      ...rewritten.map((entry) => `export type ${entry.typeName} = ${entry.body}`),
      ...entries.map((entry) => `type O_${entry.typeName} = ${entry.body}`),
      ...entries.map(
        (entry) =>
          `export const eq_${entry.typeName}: Equal<${entry.typeName}, O_${entry.typeName}> = true`,
      ),
    ])
    const check = runTsgoNoEmit(repeated)
    expect(check.output).toBe("")
    expect(check.ok).toBe(true)
    clean(repeated)
  }, 120_000)

  it("codegen.namedParts off reproduces the previous release byte for byte", async () => {
    clean(parts)
    await generate({
      root: parts,
      config: withTestTsgo({
        mode: "sidecar",
        include: ["src/*.schema.ts"],
        tsconfig: "tsconfig.json",
        codegen: { namedParts: false },
      }),
    })
    expect(read(parts, "parts.schema.gen.ts")).toBe(
      readFileSync(`${parts}/expected-previous/parts.schema.gen.txt`, "utf8"),
    )
    clean(parts)

    // The recursive walker keeps its earlier object spelling with the option off.
    clean(cycle)
    await generate({
      root: cycle,
      config: withTestTsgo({
        mode: "sidecar",
        include: ["src/*.schema.ts"],
        tsconfig: "tsconfig.json",
        worker: { execPath: process.execPath },
        codegen: { namedParts: false },
      }),
    })
    expect(read(cycle, "cycle.schema.gen.ts")).toBe(
      readFileSync(`${cycle}/expected-previous/cycle.schema.gen.txt`, "utf8"),
    )
    clean(cycle)
  }, 120_000)

  it("inplace with codegen.namedParts off leaves the source as the previous release wrote it", async () => {
    const root = copyFixture("named-parts-inplace")
    try {
      await generate({
        root,
        mode: "inplace",
        config: withTestTsgo({
          include: ["src/inplace.schema.ts"],
          tsconfig: "tsconfig.json",
          codegen: { namedParts: false },
        }),
      })
      expect(read(root, "inplace.schema.ts")).toBe(
        readFileSync(`${inplace}/expected-previous/inplace.schema.txt`, "utf8"),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)
})
