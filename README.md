# tskm

A [Standard Schema](https://standardschema.dev) compliant, functional validation library — with an **AOT type compiler** that materializes inferred types into static `.ts` files.

> **Status:** the runtime, the AOT compiler (sidecar **and** experimental in-place rewrite), watch mode, the experimental JSON Schema emitter, and the Vite plugin all work end-to-end and are covered by unit, type-level, and real-checker integration tests. In-place rewrite and JSON Schema output are opt-in/experimental.

## Overview

tskm is two things that fit together:

- **A runtime validation library** — Valibot-style, fully functional, class-free, tree-shakeable, ESM-only, with **zero runtime dependencies**. Schemas are plain objects created by factory functions, and they implement the Standard Schema `~standard` interface, so they interoperate with the Zod / Valibot / ArkType ecosystem (tRPC, TanStack, form libraries, …).

- **An AOT (ahead-of-time) type compiler** — instead of deriving a type from a schema with `z.infer<typeof schema>` at every use site, tskm pre-computes it once and writes the fully-expanded, concrete type to a real file. The answer comes from the actual TypeScript type checker, queried out of process.

It is a bun-workspaces monorepo: `@tskm/core` (runtime), `@tskm/compiler` (AOT codegen + CLI), `@tskm/vite` (Vite plugin).

## Why tskm?

`z.infer<typeof schema>` (and Valibot's `InferOutput`) is a **type-level computation**. For deeply nested schemas it makes the editor and `tsc` re-evaluate heavy conditional/mapped types on every reference — a well-known source of slow IDEs and long type-checks.

[typia](https://typia.io) attacks the cost from the other side: it generates validators from types at compile time. But it runs as a **TypeScript transformer** that has to patch the compiler via `ts-patch` (or an unplugin). That patching is fragile — it breaks on TypeScript upgrades, conflicts with other transformers, must be re-applied on install, and is invisible to the editor. (`unplugin-typia` was archived in 2025, partly because the native TypeScript port now exposes an IPC API.)

tskm goes the **opposite direction — schema → type, not type → validator — and never patches `tsc`.** A standalone compiler asks the type checker for the resolved output type and writes it out as plain TypeScript. Your build pipeline is untouched; the generated type is concrete, so consuming it costs the type system nothing.

|                    | typia                       | tskm                          |
| ------------------ | --------------------------- | ----------------------------- |
| direction          | type → validator            | **schema → type**             |
| integration        | `ts-patch` / transformer    | **standalone CLI over IPC**   |
| patches `tsc`?     | yes                         | **no**                        |
| editor sees it?    | no                          | **yes** (plain generated `.ts`) |
| runtime deps       | —                           | **zero** (runtime package)    |

Underneath the mechanics sits the actual thesis: **data-oriented domain modeling**. In tskm the runtime schema — a plain, inspectable object — *is* the domain model; the static types are compiled artifacts derived from it, never the other way around. Inference-based libraries share that ambition but cannot hold it at the edges: the moment a model is self-referential (a category tree, an AST, a JSON document), the inferred type collapses, and the library hands the work back to you as a hand-written `type` plus a `GenericSchema<T>` annotation — type-first creep, exactly what data-first modeling set out to remove. Because tskm derives types with a compiler instead of inference, the data stays the SSoT even there: `recursive((self) => …)` materializes the self-referential alias with zero hand-written types. Validation, transformation, JSON Schema, and the static types all keep flowing from one place — the data. The AOT compiler is not an optimization bolted onto the library; it is what makes this concept hold end to end.

## Simple Usage

**Validate at runtime** — schemas are values; `parse` / `safeParse` are standalone functions:

```ts
import { object, string, number, array, pipe, minLength, parse, safeParse } from "@tskm/core"

const userSchema = object({
  name: pipe(string(), minLength(2)),
  age: number(),
  tags: array(string()),
})

parse(userSchema, { name: "Ada", age: 36, tags: ["math"] })
// → typed output; throws a TskmError on failure

const result = safeParse(userSchema, { name: "", age: 1, tags: [] })
// → { success: false, issues: [...] }  (discriminated result, never throws)
```

**Materialize the type** — run the compiler and import the generated type:

```ts
// user.schema.ts  (you write — note: no `type User = Infer<...>` needed)
import { object, string, number, array, pipe, minLength } from "@tskm/core"

export const userSchema = object({
  name: pipe(string(), minLength(2)),
  age: number(),
  tags: array(string()),
})
```

```bash
tskm gen        # queries the checker, writes user.schema.gen.ts
```

```ts
// user.schema.gen.ts  (generated — concrete, zero generic cost)
// AUTO-GENERATED by tskm. Do not edit.
export type User = {
  name: string
  age: number
  tags: string[]
}
```

```ts
import type { User } from "./user.schema.gen"
```

Schemas: `string number boolean bigint date literal null_ undefined_ any unknown never_ picklist object array record tuple union optional nullable nullish lazy recursive` (+ async `objectAsync` `arrayAsync` `unionAsync`).
Actions (via `pipe`): `minLength maxLength length minValue maxValue integer multipleOf email url regex nonEmpty check transform brand readonly` (+ `checkAsync` `transformAsync`).
Methods: `pipe parse safeParse is assert fallback` (+ `parseAsync safeParseAsync pipeAsync`).

## CLI

```bash
tskm init           # write a starter tskm.config.ts
tskm gen            # generate sidecar .gen.ts for every included schema
tskm gen --mode inplace   # rewrite `type T = Infer<typeof X>` markers in place (experimental)
tskm watch          # generate, then re-generate on change
tskm json-schema    # emit JSON Schema per schema, via an isolated worker (experimental)
```

Use it from Vite with `@tskm/vite`: `import { tskm } from "@tskm/vite"` and add `tskm()` to `plugins` —
it runs the compiler on `buildStart` and watches during `vite dev`.

## How It Works

The compiler never reads your schema at runtime — the inferred type only exists in the type system, so it asks the type checker directly:

1. **Discover** — [`oxc-parser`](https://oxc.rs) scans each source file (syntactically) for exported `const`s whose factory is imported from `@tskm/core`, and for explicit `type T = Infer<typeof X>` markers.
2. **Query** — for each schema, the compiler writes a tiny sibling file (`<base>.tskm-query.ts`, deleted afterward) next to the source that declares a marker against the schema's output type:

   ```ts
   import { userSchema } from "./user.schema"
   import type { InferOutput } from "@tskm/core"
   type __P<T> = { [K in keyof T]: T[K] } & {}
   declare const __tskm_0: __P<InferOutput<typeof userSchema>>
   ```

   It then asks the **tsgo (Corsa) checker** — Microsoft's native TypeScript port, driven over its IPC API via [`@corsa-bind/napi`](https://github.com/ubugeeei-prod/corsa-bind) and the `@typescript/native-preview` binary — for the type at that marker (`getTypeAtPosition`), and renders it fully expanded with `typeToString` (no truncation, anonymous structural form). Because the answer comes from the type system, types produced by `transform`, generics, or conditional types all resolve correctly.
3. **Emit** — the resolved type is pretty-printed deterministically and written to a sidecar `*.gen.ts`. The temporary query files are deleted; your source is never modified. If a schema fails to type-check (resolves to `any`/`unknown`/`never`), the previous output is kept and a diagnostic is reported instead of overwriting good types.

4. **Recursive schemas** take a structural route instead — the plain query would collapse their self
   positions to `any` before the checker ever saw them. Discovery flags `recursive(...)` roots
   syntactically and routes them to an isolated, SIGKILL-guarded worker that imports the module and
   walks the runtime schema graph through the same identity-keyed cycle guard the JSON Schema emitter
   uses, rendering a named self-referential alias directly (`type Category = { …; children: Category[] }`).
   Transform outputs inside the cycle are recovered with one extra checker query — a one-level unroll of
   the schema's builder with a sentinel type at the self positions — and spliced in only after BOTH a
   structural data-key cross-check and a bidirectional fixpoint oracle pass; otherwise the position
   stays an honest `unknown` with a path-precise diagnostic.

The checker runs as a long-lived process: it opens the project once and is fed incremental file changes, so generating many schemas stays fast. No `tsc` plugin, no `ts-patch`, no transformer in your build.

## Type support

**Sidecar / in-place `.ts` output has no fixed "supported subset".** Because the type comes from the
real checker, whatever `InferOutput<typeof schema>` resolves to is what you get — including types produced
by `transform`, generics, and conditional types. The only failure mode is **fail-closed**: if a schema
resolves to `any`/`unknown`/`never`, the previous output is kept and a diagnostic is reported.

The **experimental JSON Schema** emitter is different: it walks the runtime schema structurally, so it has
a documented mapping (and warns on anything it cannot represent).

| schema | generated `.ts` type | JSON Schema (draft 2020-12) |
| --- | --- | --- |
| `string` `number` `boolean` | `string` `number` `boolean` | `{ "type": … }` |
| `bigint` | `bigint` | `{ "type": "string" }` ⚠ |
| `date` | `Date` | `{ "type": "string", "format": "date-time" }` ⚠ |
| `literal(x)` | `x` (non-finite numbers widen to `number` ⚠) | `{ "const": x }` |
| `picklist([…])` | union of literals | `{ "enum": […] }` |
| `null_` `undefined_` | `null` `undefined` | `{ "type": "null" }` · `{}` ⚠ |
| `any` `unknown` `never_` | `any` `unknown` `never` | `{}` · `{}` · `{ "not": {} }` |
| `object({…})` | `{ k: T }` | `{ "type": "object", "properties", "required", "additionalProperties": false }` |
| `array(T)` | `T[]` | `{ "type": "array", "items": T }` |
| `record(V)` | `{ [key: string]: V }` (index signature — also legal inside recursive aliases) | `{ "type": "object", "additionalProperties": V }` |
| `tuple([A, B])` | `[A, B]` | `{ "type": "array", "prefixItems": [A, B], "items": false }` |
| `union([A, B])` | `A \| B` | `{ "anyOf": [A, B] }` |
| `optional(T)` | `T \| undefined` | inside `object`: `T`, key dropped from `required`; standalone: `T` ⚠ (drops `undefined`) |
| `nullable(T)` | `T \| null` | `{ "anyOf": [T, { "type": "null" }] }` |
| `nullish(T)` | `T \| null \| undefined` | `{ "anyOf": [T, { "type": "null" }] }` ⚠ (drops `undefined`) |
| `lazy(() => T)` | recursive `T` (needs a hand-written annotation) | `$ref` / `$defs` |
| `recursive((self) => …)` | **named self-referential alias, materialized** | `$ref` / `$defs` (export-named) |
| pipe `minLength`/`maxLength`/`length`/`nonEmpty` | unchanged | `minLength`/`maxLength` (or `minItems`/`maxItems`) |
| pipe `minValue`/`maxValue`/`integer`/`multipleOf` | unchanged | `minimum`/`maximum`/`"type":"integer"`/`multipleOf` (numeric bases only) |
| pipe `email`/`url`/`regex` | unchanged | `format: "email"`/`format: "uri"`/`pattern` |
| pipe `transform`/`brand`/`check`/`readonly` (+ `checkAsync`/`transformAsync`) | **output type** (resolved) | ⚠ not representable — warns, keeps the base constraints |

⚠ = lossy or unrepresentable in JSON Schema; the emitter records a warning.

## Standard Schema interop

The compiler is not tskm-specific: any **[Standard Schema](https://standardschema.dev)** library is a type source. Discovery is hybrid — syntactic candidates (imports from `schemaSources`, default `["zod", "valibot", "arktype"]`, opt out with `schemaSources: []`) confirmed by an any-guarded checker probe — and the query itself is pure structure (`NonNullable<(typeof x)["~standard"]["types"]>["output"]`), so the same expression resolves every vendor:

```ts
// tskm.config.ts — optional; zod/valibot/arktype are on by default
export default { schemaSources: ["zod"] }
```

| library | minimum version | `.ts` types | JSON Schema |
| --- | --- | --- | --- |
| tskm | — | full | built-in walker |
| zod | ≥ 3.24 (verified on 4.4.3) | full | native (`~standard.jsonSchema`, spec 1.1) or `z.toJSONSchema` |
| valibot | ≥ 1.0 (verified on 1.4.1) | full | [`@valibot/to-json-schema`](https://www.npmjs.com/package/@valibot/to-json-schema) (add it to your project) |
| arktype | ≥ 2.0 (verified on 2.2.0) | full | native (`~standard.jsonSchema`, spec 1.1) |
| anything else with `~standard` types | spec 1.0+ | best effort (same query) | native converter if it ships one |

What you should know:

- **Output side only**: the generated type is the schema's `output` (post-`transform`/`default`); JSON Schema follows `jsonSchema.io` in the config (default `"output"`).
- **Brands keep their marker**: a branded type IS `base & Marker<…>`, so the sidecar imports it (`import type { $brand } from "zod"`, `import type { Brand } from "valibot"`).
- **External recursion needs the library's own self annotation** (`z.ZodType<T>` / `v.GenericSchema<T>`), and that annotation type must be **exported** (the sidecar imports it; an aliased re-export — `export type { CatT as PublicCat }` — is rebound on import, while a local-only name is skipped with a diagnostic). Annotation-free recursion emits exactly what the library itself infers — self-truncated, with `any`/`unknown` at the cut — same as your editor shows.
- **Compile gate**: before an external-bearing sidecar is written it is verified against the real checker; a type that would not compile is skipped with a diagnostic and the previous output stays.
- **External schemas are sidecar-only** (in-place markers stay tskm-only) and never enter the tskm structural walker or Tier-1 — those read tskm's internal conventions.
- A JSON Schema conversion an external converter rejects (zod `bigint`/`date`/`transform`, valibot `transform`, …) is skipped per schema with the converter's reason; the rest of the file still emits.
- **Other libraries are opt-in, not auto-detected**: only the configured `schemaSources` are scanned, so a Standard Schema library outside the default three produces nothing until you add its package to `schemaSources` — the pipeline itself is vendor-generic (the type query, recursion annotations, the compile gate and spec-1.1 JSON Schema converters all work unchanged for a never-seen vendor).
- **Vendor identity is the package root**: tskm derives each source's vendor name from its package root (`zod/v4` → `zod`) and matches it against the runtime `~standard` vendor string for JSON Schema allow-listing and brand-marker imports — true for zod/valibot/arktype. A library whose vendor string differs from its package root is reported per file as not-allow-listed (never silently dropped) but cannot currently be enabled for JSON Schema delegation.

See [`examples/standard-schema`](examples/standard-schema) for the end-to-end loop over all three vendors (transforms, brands, annotated recursion, an arktype morph).

## Limitations

- **Schema discovery is syntactic and conservative.** Sidecar auto-discovery only matches a direct `export const x = <tskm factory>(…)`. Schemas built through a local helper (`export const x = make()`), a `satisfies` clause, a re-export, or a namespace import are **not** found — add an explicit `export type T = Infer<typeof x>` marker for those. For **recursive** schemas the marker must live in the schema's defining file; cross-file markers fail closed (see below).
- **One alias per derived name.** Two exports that derive the same type name (`user` and `userSchema` both → `User`) keep the FIRST declaration (discovery order); the later one is skipped with a diagnostic. The canonical `export const aSchema = …` + `export type A = Infer<typeof aSchema>` pair emits exactly one `A`.
- **Recursive schemas: use `recursive()`.** `export const categorySchema = recursive((self) => object({ name: string(), children: array(self) }))` materializes `type Category = { name: string; children: Category[] }` with **no hand-written annotation**: the self-reference is passed into the builder, so the implicit-any rule for self-referential initializers never fires. Recursive roots are the one place type generation EVALUATES your module — in an isolated, SIGKILL-guarded subprocess (set `worker.execPath` to a TS-capable runtime such as `bun` when your sources are `.ts` and the host runtime cannot import them). Same-file mutual recursion (A↔B) is supported; the pair forms a type-level cycle at authoring time, so give ONE member a loose `GenericSchema` annotation (still no structural type by hand). A specifier-form export (`const node = recursive(…); export { node }`) resolves through an explicit `export type Node = Infer<typeof node>` marker — auto-discovery without a marker still requires the inline `export const` form. Everything cross-file fails CLOSED — skip plus a diagnostic, never a wrong or dangling alias: a recursive schema **imported** (or re-exported) into another file is not inlined there, a cross-file `Infer<typeof imported>` alias is rejected by the checker guard, and a generated body that would reference a sibling alias which itself failed is pruned with it (cycles through non-exported values stay unsupported). Declare recursive aliases in the file that defines the schema.
- **Transforms inside a recursive cycle** resolve when the builder is a GENERIC arrow (`recursive(<S extends GenericSchema>(self: S) => …)`): the compiler asks the checker for a one-level unroll of the builder with a sentinel at the self positions, then splices the result only after BOTH a structural data-key cross-check and a bidirectional fixpoint oracle pass (a wrong candidate is rejected, never emitted). A `brand` directly under a union/tuple root is always rejected — with no data keys, both gates would be blind to brand absorption. Any rejection keeps the honest floor: `unknown` at the transform position with a path-precise diagnostic. A plain-arrow builder cannot be unrolled and always gets the floor.
- **`lazy` stays as the non-recursive defer / escape hatch.** lazy-based recursion still needs the old hand-written `GenericSchema<T>` annotation and is not auto-materialized in v1. At runtime both `lazy` and `recursive` follow the input's depth and are not cycle-guarded, so a pathologically deep value can overflow the stack.
- **`optional(x)`** renders as `k: T | undefined`, not `k?: T` (the value is the same; the key is still required in the object position). JSON Schema correctly drops it from `required`.
- **In-place mode** only recognizes *single-line* `export type T = Infer<typeof X>` markers, and trailing content on that line is dropped on first conversion. It is experimental and opt-in.
- **JSON Schema** runs your schema module in an isolated subprocess; it assumes the module is side-effect-free and imports cleanly under the chosen runtime (`--exec`/`execPath`). `transform`/refinements that JSON Schema can't express are warned and omitted. `minValue`/`maxValue` map to `minimum`/`maximum` and are only meaningful on a number base (on a `date` base they emit numeric bounds that don't apply to the string schema). Recursive (`lazy`/`recursive`) schemas become `$ref`/`$defs`; `recursive()` roots are named after their exports (`Category`), while other hoisted cycles keep kind-derived names (`object`, `object_2`, …).
- **`union`** emits a single schema-level issue on failure (no per-member aggregation yet).
- **`pipe(schema, transform(fn))`** infers `fn`'s input from an explicit parameter annotation; annotate it (`transform((s: string) => …)`) when the input isn't otherwise constrained.

## Examples

- [`examples/basic`](examples/basic) — the smallest end-to-end loop: schema → generated type → validate.
- [`examples/advanced`](examples/advanced) — discriminated unions, a recursive JSON schema materialized by `recursive()`, and the explicit `export type T = Infer<typeof schema>` marker.
- [`examples/standard-schema`](examples/standard-schema) — **zod, valibot and arktype** schemas compiled by one tskm pipeline: transform/morph output types, branded ids (`$brand`/`Brand` imports), annotated recursion.

## Development

```bash
bun install
bun run build          # tsdown → dist (ESM + .d.ts)
bun run test           # vitest: unit + type + integration lanes
bun run lint           # biome
```

## License

MIT
