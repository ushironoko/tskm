# @tskm/compiler

## 0.2.0

### Minor Changes

- ec19bc1: Standard Schema generic compilation: zod / valibot / arktype schemas are now AOT type sources.

  - Hybrid discovery: syntactic candidates from `schemaSources` (NEW config, **default `["zod", "valibot", "arktype"]`** — `@tskm/core` is always implicit; pass `[]` to opt out), confirmed by an any-guarded `~standard` checker probe. **Behavior expansion**: a project that already imports zod/valibot/arktype will start generating sidecars for those schemas after this update.
  - The resolver queries `NonNullable<(typeof x)["~standard"]["types"]>["output"]` — one structural expression for every vendor (tskm included; existing output is byte-identical) — with a raw/prettify dual rendering that also fixes the previous top-level `Date`/`Map`/`Set` prototype explosion.
  - Generated sidecars import what their types reference: vendor brand markers (`$brand` from zod, `Brand` from valibot) and exported self-annotation types of recursive schemas — an aliased re-export (`export { type CatT as PublicCat }`) is rebound on import (`import type { PublicCat as CatT }`). A non-exported annotation, or any render that would not compile, is skipped fail-closed (new pre-write compile gate) with a diagnostic; the previous output stays.
  - JSON Schema gains a vendor adapter: spec 1.1 native converters (`~standard.jsonSchema` — zod 4 / arktype), `@valibot/to-json-schema` delegation (with install guidance when missing), the tskm walker, and per-schema skip diagnostics for unrepresentable types. New `jsonSchema.io` config (default `"output"`).
  - The structural walker and Tier-1 are now explicitly gated to tskm schemas via per-target capability metadata (a valibot schema's `kind: "schema"` can no longer reach the tskm walker), and inplace mode reports external schemas as unsupported instead of staying silent.
  - Diagnostics never go silent at the vendor boundary: JSON Schema exports excluded by the vendor allow-list surface one aggregated diagnostic per file and vendor (naming the allow-list and the package-root requirement), and a compile-gate failure now names the unresolved identifier(s) with a leak hint instead of only the TS code.

## 0.1.0

### Minor Changes

- 512f778: Materialize recursive schema types with no hand-written annotation.

  `@tskm/core` adds the `recursive((self) => …)` fixpoint combinator — the
  self-reference is passed into the builder, so the implicit-any rule for
  self-referential initializers never fires and no `GenericSchema<T>` annotation is
  needed.

  `@tskm/compiler` routes `recursive(...)` roots to a new structural path: an
  isolated worker walks the runtime schema graph through a shared identity-keyed
  cycle guard and emits named self-referential aliases
  (`type Category = { name: string; children: Category[] }`), including same-file
  mutual recursion. Transforms inside a cycle resolve through a sentinel-unroll
  checker query gated by a data-key cross-check and a bidirectional fixpoint oracle;
  any rejection keeps an honest `unknown` floor with path-precise diagnostics.
  JSON Schema names recursive `$defs` after their exports (`Category` instead of
  `object_2`).

  The structural emitter is fail-closed end to end: object keys stay REQUIRED with
  the union on the value (`k: T | undefined`, matching the runtime parser and
  `InferObjectOutput`), the walker's identity map is seeded from declared targets
  only (a re-exported or imported recursive schema can never become a dangling or
  inlined alias), duplicate declared aliases collapse to one canonical alias plus a
  thin re-export, and a dangling-alias prune cascades over anything that would
  reference a sibling alias that could not be emitted.

  Spec-first hardening: non-finite number literals (`NaN`/`Infinity`) widen to
  `number` with a warning instead of emitting non-compiling tokens; duplicate
  derived type names (`user` + `userSchema`) skip with a diagnostic instead of
  aborting the run; the canonical const+`Infer`-alias pair emits exactly one
  alias (never a circular `type A = A`); the brand-absorption cross-check is
  root-level-aware and a brand under a non-object recursive root now fails
  closed; property keys named like sibling aliases no longer false-positive the
  dangling-alias prune.
