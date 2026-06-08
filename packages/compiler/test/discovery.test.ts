import { describe, expect, it } from "bun:test"
import {
  type DiscoveredSchema,
  deriveTypeName,
  discoverSchemas,
  tskmCapability,
} from "../src/discovery.ts"

const find = (
  schemas: ReadonlyArray<DiscoveredSchema>,
  name: string,
): DiscoveredSchema | undefined => schemas.find((s) => s.name === name)

/** Expected capability of a tskm-discovered schema (the only kind in this suite). */
const tskmCap = (recursive = false) => tskmCapability(recursive)

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
      import { object, string } from "@tskm/core"
      export const userSchema = object({ name: string() })
    `
    const { schemas, diagnostics } = discoverSchemas("a.ts", src)
    expect(diagnostics).toHaveLength(0)
    expect(schemas).toHaveLength(1)
    const found = find(schemas, "userSchema")
    expect(found).toEqual({
      name: "userSchema",
      typeName: "User",
      origin: "const",
      recursive: false,
      capability: tskmCap(),
    })
  })

  it("ignores consts whose callee is not a tskm runtime import", () => {
    const src = `
      import { object } from "@tskm/core"
      import { other } from "elsewhere"
      export const x = other({ a: 1 })
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores a const whose init is not a call expression", () => {
    const src = `
      import { object } from "@tskm/core"
      export const notACall = 42
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores a call whose callee is not a plain identifier (member expression)", () => {
    const src = `
      import { v } from "@tskm/core"
      export const x = v.object({ a: 1 })
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("ignores non-exported consts", () => {
    const src = `
      import { string } from "@tskm/core"
      const internalSchema = string()
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("honors runtime-import local aliasing (import { object as o })", () => {
    const src = `
      import { object as o, string } from "@tskm/core"
      export const petSchema = o({ name: string() })
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(find(schemas, "petSchema")).toEqual({
      name: "petSchema",
      typeName: "Pet",
      origin: "const",
      recursive: false,
      capability: tskmCap(),
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
      import { string } from "@tskm/core"
      import type { Infer } from "@tskm/core"
      const xSchema = string()
      export type X = Infer<typeof xSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    const alias = schemas.find((s) => s.origin === "alias")
    expect(alias).toEqual({
      name: "xSchema",
      typeName: "X",
      origin: "alias",
      recursive: false,
      capability: tskmCap(),
    })
  })

  it("discovers an InferOutput alias marker", () => {
    const src = `
      const ySchema = {}
      export type Y = InferOutput<typeof ySchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toEqual([
      { name: "ySchema", typeName: "Y", origin: "alias", recursive: false, capability: tskmCap() },
    ])
  })

  it('discovers the import("@tskm/core").InferOutput<...> qualified form', () => {
    const src = `
      const zSchema = {}
      export type Z = import("@tskm/core").InferOutput<typeof zSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toEqual([
      { name: "zSchema", typeName: "Z", origin: "alias", recursive: false, capability: tskmCap() },
    ])
  })

  it('discovers the import("@tskm/core").Infer<...> qualified form', () => {
    const src = `
      const wSchema = {}
      export type W = import("@tskm/core").Infer<typeof wSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toEqual([
      { name: "wSchema", typeName: "W", origin: "alias", recursive: false, capability: tskmCap() },
    ])
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
      export type Q = import("@tskm/core").SomethingElse<typeof qSchema>
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
      import { object, string, number } from "@tskm/core"
      import type { Infer } from "@tskm/core"
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
    expect(hidden).toEqual({
      name: "hiddenSchema",
      typeName: "Hidden",
      origin: "alias",
      recursive: false,
      capability: tskmCap(),
    })
  })

  it("does not re-add a const name already seen", () => {
    const src = `
      import { string } from "@tskm/core"
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

describe("discoverSchemas — recursive flag", () => {
  it("flags an exported recursive(...) const", () => {
    const src = `
      import { object, recursive, string } from "@tskm/core"
      export const categorySchema = recursive((self) => object({ name: string() }))
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(find(schemas, "categorySchema")).toEqual({
      name: "categorySchema",
      typeName: "Category",
      origin: "const",
      recursive: true,
      capability: tskmCap(true),
    })
  })

  it("keeps lazy- and object-built consts non-recursive", () => {
    const src = `
      import { lazy, object, string } from "@tskm/core"
      export const aSchema = lazy(() => string())
      export const bSchema = object({ name: string() })
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(find(schemas, "aSchema")?.recursive).toBe(false)
    expect(find(schemas, "bSchema")?.recursive).toBe(false)
  })

  it("tracks the recursive import through a local alias (import { recursive as rec })", () => {
    const src = `
      import { recursive as rec, object } from "@tskm/core"
      export const nodeSchema = rec((self) => object({}))
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(find(schemas, "nodeSchema")?.recursive).toBe(true)
  })

  it("does not flag recursive imported from a non-tskm module", () => {
    const src = `
      import { recursive } from "not-tskm"
      export const xSchema = recursive((self) => self)
    `
    const { schemas } = discoverSchemas("a.ts", src)
    // Not a runtime import at all, so it is not even discovered.
    expect(schemas).toHaveLength(0)
  })

  it("inherits the flag onto an Infer alias of a recursive const", () => {
    const src = `
      import { object, recursive } from "@tskm/core"
      import type { Infer } from "@tskm/core"
      const categorySchema = recursive((self) => object({}))
      export type Category = Infer<typeof categorySchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toEqual([
      {
        name: "categorySchema",
        typeName: "Category",
        origin: "alias",
        recursive: true,
        capability: tskmCap(true),
      },
    ])
  })

  it("inherits the flag even when the alias precedes the const (two-pass)", () => {
    const src = `
      import { object, recursive } from "@tskm/core"
      import type { Infer } from "@tskm/core"
      export type Category = Infer<typeof categorySchema>
      const categorySchema = recursive((self) => object({}))
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toEqual([
      {
        name: "categorySchema",
        typeName: "Category",
        origin: "alias",
        recursive: true,
        capability: tskmCap(true),
      },
    ])
  })

  it("keeps an alias of a non-recursive const non-recursive", () => {
    const src = `
      import { object } from "@tskm/core"
      import type { Infer } from "@tskm/core"
      const userSchema = object({})
      export type User = Infer<typeof userSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(find(schemas, "userSchema")?.recursive).toBe(false)
  })
})

describe("discoverSchemas — capability invariant", () => {
  // The load-bearing routing contract: `recursive` and `capability.typeResolver`
  // must never drift apart, across const/alias origins and both flag values.
  it("keeps recursive ⟺ typeResolver === core-recursive on every discovered schema", () => {
    const src = `
      import { object, recursive, string } from "@tskm/core"
      import type { Infer } from "@tskm/core"
      export const categorySchema = recursive((self) => object({}))
      export const userSchema = object({ name: string() })
      const hiddenSchema = recursive((self) => object({}))
      export type Hidden = Infer<typeof hiddenSchema>
      const plainSchema = string()
      export type Plain = Infer<typeof plainSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas.length).toBeGreaterThan(0)
    for (const s of schemas) {
      expect(s.recursive).toBe(s.capability.typeResolver === "core-recursive")
      expect(s.capability.tier1Supported).toBe(s.recursive)
    }
  })
})

const EXTERNAL_SOURCES = ["@tskm/core", "zod", "valibot", "arktype"]
const opts = { schemaSources: EXTERNAL_SOURCES }

/** Expected capability of an external Standard Schema candidate. */
const candidateCap = (vendorHint: string) =>
  ({
    sourceKind: "standard",
    vendorHint,
    confidence: "candidate",
    typeResolver: "standard-checker",
    tier1Supported: false,
    inplaceSupported: false,
  }) as const

describe("discoverSchemas — external schema sources (hybrid candidates)", () => {
  it("discovers a valibot namespace call (import * as v) as a candidate", () => {
    const src = `
      import * as v from "valibot"
      export const userSchema = v.object({ name: v.string() })
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "userSchema")).toEqual({
      name: "userSchema",
      typeName: "User",
      origin: "const",
      recursive: false,
      capability: candidateCap("valibot"),
    })
  })

  it("discovers a zod named-import member call (import { z }) as a candidate", () => {
    const src = `
      import { z } from "zod"
      export const userSchema = z.object({ name: z.string() })
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "userSchema")?.capability).toEqual(candidateCap("zod"))
  })

  it("discovers a chained builder call (z.string().brand()) through the root identifier", () => {
    const src = `
      import { z } from "zod"
      export const idSchema = z.string().brand()
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "idSchema")?.capability.vendorHint).toBe("zod")
  })

  it("discovers an arktype identifier call (import { type }) as a candidate", () => {
    const src = `
      import { type } from "arktype"
      export const user = type({ name: "string" })
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "user")?.capability).toEqual(candidateCap("arktype"))
  })

  it("matches a subpath import (zod/v4) to its source and normalizes the vendor hint", () => {
    const src = `
      import { z } from "zod/v4"
      export const userSchema = z.object({})
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "userSchema")?.capability.vendorHint).toBe("zod")
  })

  it("normalizes an explicit subpath SOURCE entry (schemaSources: [zod/v4]) to its vendor root", () => {
    // The matched source string is "zod/v4", but the vendor identity — what
    // brand-import gating and the JSON Schema allow-list compare against — is
    // the package root "zod".
    const src = `
      import { z } from "zod/v4"
      export const userSchema = z.object({})
    `
    const { schemas } = discoverSchemas("a.ts", src, {
      schemaSources: ["@tskm/core", "zod/v4"],
    })
    expect(find(schemas, "userSchema")?.capability.vendorHint).toBe("zod")
  })

  it("discovers a default-import call as a candidate", () => {
    const src = `
      import v from "valibot"
      export const xSchema = v.object({})
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "xSchema")?.capability.vendorHint).toBe("valibot")
  })

  it("ignores calls from modules outside schemaSources", () => {
    const src = `
      import * as yup from "yup"
      export const ySchema = yup.object({})
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(schemas).toHaveLength(0)
  })

  it("ignores packages whose name merely starts with a source (zod-extra)", () => {
    const src = `
      import { z } from "zod-extra"
      export const zSchema = z.object({})
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(schemas).toHaveLength(0)
  })

  it("routes a `recursive` named import to core-recursive from ANY configured source", () => {
    // `recursive` is a tskm-specific export name (zod/valibot/arktype publish no
    // such export), so a re-export hub that forwards it must still route the root to
    // the structural walker — that is what makes the anti-corruption-layer pattern
    // work without an Infer marker. Safety net: the worker validates the runtime
    // value (`type === "recursive"` && tskm vendor) before walking, so a hypothetical
    // NON-tskm `recursive` export is skipped with a diagnostic, never emitted wrong.
    const src = `
      import { recursive } from "@acme/hub"
      export const xSchema = recursive((self) => self)
    `
    const { schemas } = discoverSchemas("a.ts", src, {
      schemaSources: ["@tskm/core", "@acme/hub"],
    })
    const found = find(schemas, "xSchema")
    expect(found?.recursive).toBe(true)
    expect(found?.capability).toEqual(tskmCap(true))
  })

  it("keeps a NON-recursive hub schema a standard candidate (only `recursive` is special)", () => {
    // The hub forwards `object` too, but a non-recursive root has no tskm-specific
    // signal at parse time, so it stays an external candidate confirmed by the
    // `~standard` probe on the checker path — unchanged behavior.
    const src = `
      import { object, string } from "@acme/hub"
      export const userSchema = object({ name: string() })
    `
    const { schemas } = discoverSchemas("a.ts", src, {
      schemaSources: ["@tskm/core", "@acme/hub"],
    })
    expect(find(schemas, "userSchema")?.capability).toEqual(candidateCap("@acme/hub"))
  })

  it("inherits hub core-recursive onto an Infer alias", () => {
    const src = `
      import { recursive } from "@acme/hub"
      const treeSchema = recursive((self) => self)
      export type Tree = Infer<typeof treeSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src, {
      schemaSources: ["@tskm/core", "@acme/hub"],
    })
    expect(find(schemas, "treeSchema")).toEqual({
      name: "treeSchema",
      typeName: "Tree",
      origin: "alias",
      recursive: true,
      capability: tskmCap(true),
    })
  })

  it("defaults to tskm-only discovery when no schemaSources are passed", () => {
    const src = `
      import { z } from "zod"
      export const userSchema = z.object({})
    `
    const { schemas } = discoverSchemas("a.ts", src)
    expect(schemas).toHaveLength(0)
  })

  it("still ignores a tskm member-expression call (member path is external-only)", () => {
    const src = `
      import { v } from "@tskm/core"
      export const x = v.object({ a: 1 })
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(schemas).toHaveLength(0)
  })

  it("inherits the external capability onto an Infer alias (both declaration orders)", () => {
    const after = `
      import { z } from "zod"
      const catSchema = z.object({})
      export type Cat = Infer<typeof catSchema>
    `
    const before = `
      import { z } from "zod"
      export type Cat = Infer<typeof catSchema>
      const catSchema = z.object({})
    `
    for (const src of [after, before]) {
      const { schemas } = discoverSchemas("a.ts", src, opts)
      expect(schemas).toEqual([
        {
          name: "catSchema",
          typeName: "Cat",
          origin: "alias",
          recursive: false,
          capability: candidateCap("zod"),
        },
      ])
    }
  })
})

describe("discoverSchemas — recursive self-annotation capture", () => {
  it("captures an exported zod self-annotation type (z.ZodType<CatT>)", () => {
    const src = `
      import { z } from "zod"
      export type CatT = { name: string; kitten?: CatT }
      export const catSchema: z.ZodType<CatT> = z.lazy(() => z.object({}))
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "catSchema")?.recursiveAnnotation).toEqual({
      name: "CatT",
      exported: true,
    })
  })

  it("captures a LOCAL (non-exported) annotation type as exported: false", () => {
    const src = `
      import { z } from "zod"
      type CatT = { name: string }
      export const catSchema: z.ZodType<CatT> = z.lazy(() => z.object({}))
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "catSchema")?.recursiveAnnotation).toEqual({
      name: "CatT",
      exported: false,
    })
  })

  it("captures a valibot GenericSchema annotation (plain identifier reference)", () => {
    const src = `
      import * as v from "valibot"
      export interface VNode { value: number; children: VNode[] }
      export const nodeSchema: v.GenericSchema<VNode> = v.object({})
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "nodeSchema")?.recursiveAnnotation).toEqual({
      name: "VNode",
      exported: true,
    })
  })

  it("treats a re-exported local type (export { CatT }) as exported", () => {
    const src = `
      import { z } from "zod"
      type CatT = { name: string }
      export { type CatT }
      export const catSchema: z.ZodType<CatT> = z.lazy(() => z.object({}))
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "catSchema")?.recursiveAnnotation?.exported).toBe(true)
  })

  it("records the importable name of an ALIASED re-export (export { CatT as PublicCat })", () => {
    // `CatT` is what the rendered type references, but importers only see
    // `PublicCat` — emit must rebind (`import type { PublicCat as CatT }`).
    const src = `
      import { z } from "zod"
      type CatT = { name: string }
      export { type CatT as PublicCat }
      export const catSchema: z.ZodType<CatT> = z.lazy(() => z.object({}))
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "catSchema")?.recursiveAnnotation).toEqual({
      name: "CatT",
      exported: true,
      exportedAs: "PublicCat",
    })
  })

  it("prefers the identity export when a type is exported both plainly and aliased", () => {
    const src = `
      import { z } from "zod"
      type CatT = { name: string }
      export { type CatT as PublicCat, type CatT }
      export const catSchema: z.ZodType<CatT> = z.lazy(() => z.object({}))
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "catSchema")?.recursiveAnnotation).toEqual({
      name: "CatT",
      exported: true,
    })
  })

  it("leaves recursiveAnnotation undefined for unannotated consts", () => {
    const src = `
      import { z } from "zod"
      export const plainSchema = z.object({})
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    expect(find(schemas, "plainSchema")?.recursiveAnnotation).toBeUndefined()
  })

  it("inherits the annotation onto an Infer alias of the annotated const", () => {
    const src = `
      import { z } from "zod"
      type CatT = { name: string }
      const catSchema: z.ZodType<CatT> = z.lazy(() => z.object({}))
      export type Cat = Infer<typeof catSchema>
    `
    const { schemas } = discoverSchemas("a.ts", src, opts)
    const alias = schemas.find((s) => s.origin === "alias")
    expect(alias?.recursiveAnnotation).toEqual({ name: "CatT", exported: false })
  })
})
