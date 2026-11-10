import { afterAll, describe, expect, it } from "bun:test"
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"
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
  for (const root of [parts, cross, reserved, cycle]) {
    clean(root)
  }
})

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
    const source = `${inplace}/src/inplace.schema.ts`
    const original = readFileSync(source, "utf8")
    try {
      const result = await generate({
        root: inplace,
        mode: "inplace",
        config: withTestTsgo({ include: ["src/inplace.schema.ts"], tsconfig: "tsconfig.json" }),
      })
      expect(result.diagnostics).toEqual([])
      const written = readFileSync(source, "utf8")
      expect(written).toContain("  address: Address;")
      expect(written).toContain("// @tskm-end Profile")

      writeProbe(inplace, "inplace.check.ts", [
        `import type { Infer } from "@tskm/core"`,
        `import type { Address, Profile } from "./inplace.schema.ts"`,
        `import type { addressSchema, profileSchema } from "./inplace.schema.ts"`,
        EQUAL,
        `export const eqAddress: Equal<Address, Infer<typeof addressSchema>> = true`,
        `export const eqProfile: Equal<Profile, Infer<typeof profileSchema>> = true`,
      ])
      const check = runTsgoNoEmit(inplace)
      expect(check.output).toBe("")
      expect(check.ok).toBe(true)
    } finally {
      // Inplace rewrites the source, so the committed source is put back whatever happened.
      writeFileSync(source, original)
      clean(inplace)
    }
  }, 120_000)
})
