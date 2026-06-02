import { describe, expect, it } from "bun:test"
import { type DiscoveredSchema, deriveTypeName, discoverSchemas } from "../src/discovery.ts"

const find = (
  schemas: ReadonlyArray<DiscoveredSchema>,
  name: string,
): DiscoveredSchema | undefined => schemas.find((s) => s.name === name)

describe("deriveTypeName", () => {
  it("strips a trailing Schema suffix and capitalizes", () => {
    expect(deriveTypeName("userSchema")).toBe("User")
  })

  it("capitalizes names without the Schema suffix", () => {
    expect(deriveTypeName("address")).toBe("Address")
  })

  it("leaves an already-capitalized name capitalized while stripping Schema", () => {
    expect(deriveTypeName("AccountSchema")).toBe("Account")
  })

  it("does not strip when Schema is not a trailing suffix", () => {
    expect(deriveTypeName("schemaName")).toBe("SchemaName")
  })

  // When the whole name IS "Schema", stripping leaves an empty string; the source
  // falls back to capitalizing the original `constName` (still "Schema").
  it("falls back to the original name when stripping empties it", () => {
    expect(deriveTypeName("Schema")).toBe("Schema")
  })

  it("falls back for lowercase bare suffix and re-capitalizes", () => {
    expect(deriveTypeName("schema")).toBe("Schema")
  })
})

describe("discoverSchemas — const (alias-origin) factory declarations", () => {
  it("discovers an exported const built from a tskm runtime import", () => {
    const src = `
      import { object, string } from "tskm"
      export const userSchema = object({ name: string() })
    `
    const { schemas, diagnostics } = discoverSchemas("a.ts", src)
    expect(diagnostics).toHaveLength(0)
    expect(schemas).toHaveLength(1)
    const found = find(schemas, "userSchema")
    expect(found).toEqual({ name: "userSchema", typeName: "User", origin: "const" })
  })

  it("ignores consts whose callee is not a tskm runtime import", () => {
    const src = `
      import { object } from "tskm"
      import { other } from "elsewhere"
      export const x = other({ a: 1 })
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores a const whose init is not a call expression", () => {
    const src = `
      import { object } from "tskm"
      export const notACall = 42
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores a call whose callee is not a plain identifier (member expression)", () => {
    const src = `
      import { v } from "tskm"
      export const x = v.object({ a: 1 })
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores non-exported consts", () => {
    const src = `
      import { string } from "tskm"
      const internalSchema = string()
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("honors runtime-import local aliasing (import { object as o })", () => {
    const src = `
      import { object as o, string } from "tskm"
      export const petSchema = o({ name: string() })
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(find(schemas, "petSchema")).toEqual({
      name: "petSchema",
      typeName: "Pet",
      origin: "const",
    })
  })

  it("does not treat imports from other modules as runtime markers", () => {
    const src = `
      import { object } from "not-tskm"
      export const fakeSchema = object({})
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })
})

describe("discoverSchemas — Infer alias markers", () => {
  it("discovers an export type T = Infer<typeof X> marker", () => {
    const src = `
      import { string } from "tskm"
      import type { Infer } from "tskm"
      const xSchema = string()
      export type X = Infer<typeof xSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    const alias = schemas.find((s) => s.origin === "alias")
    expect(alias).toEqual({ name: "xSchema", typeName: "X", origin: "alias" })
  })

  it("discovers an InferOutput alias marker", () => {
    const src = `
      const ySchema = {}
      export type Y = InferOutput<typeof ySchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toEqual([{ name: "ySchema", typeName: "Y", origin: "alias" }])
  })

  it('discovers the import("tskm").InferOutput<...> qualified form', () => {
    const src = `
      const zSchema = {}
      export type Z = import("tskm").InferOutput<typeof zSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toEqual([{ name: "zSchema", typeName: "Z", origin: "alias" }])
  })

  it('discovers the import("tskm").Infer<...> qualified form', () => {
    const src = `
      const wSchema = {}
      export type W = import("tskm").Infer<typeof wSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toEqual([{ name: "wSchema", typeName: "W", origin: "alias" }])
  })

  it("ignores an import-type qualifier from a non-tskm module", () => {
    const src = `
      const qSchema = {}
      export type Q = import("elsewhere").InferOutput<typeof qSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores an import-type whose qualifier is not an Infer alias", () => {
    const src = `
      const qSchema = {}
      export type Q = import("tskm").SomethingElse<typeof qSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores a type reference that is not an Infer alias", () => {
    const src = `
      const aSchema = {}
      export type A = SomethingElse<typeof aSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores an Infer alias whose argument is not a typeof query", () => {
    const src = `
      export type A = Infer<string>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores an Infer alias with no type arguments", () => {
    const src = `
      export type A = Infer
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores a bare exported type alias with no annotation match", () => {
    const src = `
      export type Plain = string
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })
})

describe("discoverSchemas — multiple schemas & dedup", () => {
  it("collects const and alias origins together from one file", () => {
    const src = `
      import { object, string, number } from "tskm"
      import type { Infer } from "tskm"
      export const userSchema = object({ name: string() })
      export const ageSchema = number()
      const hiddenSchema = string()
      export type Hidden = Infer<typeof hiddenSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(3)
    expect(find(schemas, "userSchema")?.origin).toBe("const")
    expect(find(schemas, "ageSchema")?.origin).toBe("const")
    const hidden = schemas.find((s) => s.typeName === "Hidden")
    expect(hidden).toEqual({ name: "hiddenSchema", typeName: "Hidden", origin: "alias" })
  })

  it("does not re-add a const name already seen", () => {
    const src = `
      import { string } from "tskm"
      export const dupSchema = string(), other = string()
    `
    const { schemas } = discoverSchemas("a.ts", src)
    // both declarators in one statement are processed; both are tskm calls
    expect(schemas.map((s) => s.name).sort()).toEqual(["dupSchema", "other"])
  })

  it("does not add an alias whose typeName collides with an already-seen name", () => {
    const src = `
      const aSchema = {}
      export type Dup = Infer<typeof aSchema>
      export type Dup = InferOutput<typeof aSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    const dups = schemas.filter((s) => s.typeName === "Dup")
    expect(dups).toHaveLength(1)
  })
})

describe("discoverSchemas — empty & malformed inputs", () => {
  it("returns an empty result for a file with no schemas", () => {
    const src = `
      export const config = { debug: true }
      function helper() { return 1 }
    `
    const { schemas, diagnostics } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
    expect(diagnostics).toHaveLength(0)
  })

  it("returns an empty result for an empty source string", () => {
    const { schemas, diagnostics } = discoverSchemas("a.ts", "")
    expect(schemas).toHaveLength(0)
    expect(diagnostics).toHaveLength(0)
  })

  it("surfaces parser diagnostics for syntactically invalid source", () => {
    const { diagnostics } = discoverSchemas("a.ts", "export const = =")
    expect(diagnostics.length).toBeGreaterThanOrEqual(1)
    expect(diagnostics.every((d) => typeof d === "string")).toBe(true)
  })
})
