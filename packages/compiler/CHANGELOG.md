# @tskm/compiler

## 0.4.1

### Patch Changes

- 723e719: Add a `description(text)` metadata action and map it to the JSON Schema `description` keyword

  `description()` is the first action with the new `BaseMetadata` kind: it carries its text in `requirement`, has no `~run`, and is never executed — `pipe`/`pipeAsync` drop metadata items from the run list at construction time, so parsing is unaffected and the inferred output type is preserved without explicit type arguments. The public `PipeItem` union gains `BaseMetadata`, and `BaseMetadata` is exported.

  The JSON Schema emitter folds `description` onto the accumulated schema as the `description` keyword; piping it multiple times is last-wins, and per-property descriptions inside `object()` land on the property schema.

## 0.4.0

### Minor Changes

- 830eca4: Add a `discriminatedUnion` schema with O(1) tag dispatch and discriminant metadata (issue #15), plus an async `discriminatedUnionAsync` variant.

  - `discriminatedUnion(discriminantKey, members)` builds a tag-to-member lookup once, at construction time, and on parse selects and validates only the single member named by the input's discriminant. No other member is touched, so a deep recursive tagged union parses in time proportional to the realized input shape rather than re-validating wrong branches at every level.
  - The discriminant is authoritative: a missing key, a non-object input, or an unknown tag produces a precise issue instead of falling through to a permissive member. In-member violations are still reported with the member's paths.
  - The discriminant key, the full tag set, and the tag-to-member map are exposed on the schema value as `schema.discriminant`, `schema.literals`, and `schema.mapping`, so a tag registry (tag to handler, tag to sub-schema, exhaustive switch) can be derived from the schema as the single source of truth without re-declaring the mapping. A `picklist` discriminant is expanded in `mapping`, so every one of its tags keys the same member. Misuse (a member missing the discriminant, a non-literal discriminant, or a duplicate tag) is a construction-time error. `discriminatedUnionAsync` exposes the same metadata.
  - The compiler emits a tag-narrowing union in the structural TypeScript walker and `oneOf` with the discriminant as `const` in the JSON Schema walker.

  Additive: `union`/`unionAsync` and their emission paths are unchanged; the new schema is a separate `"discriminated_union"` type with its own exports.

- 830eca4: Add a faithful optional-property mode for `object()` (issue #17). Building an object with `object(entries, { optionalKeys: true })` makes `optional` and `nullish` keys omittable across all three views of the schema, so a generated type can model the value you build rather than only the value you narrow to.

  - Runtime: under the mode, a missing `optional`/`nullish` key is left absent in the parsed output instead of materialized as `undefined`. A present value (including a default) is kept; `nullish` keeps `null`.
  - Type: `InferObjectOutput` gives those entries a `k?:` modifier with `undefined` stripped from the value (`nullish` keeps `null`), so `InferOutput` matches the runtime output.
  - Compiler: the structural TypeScript emitter renders the same `k?:` shape from the schema graph.

  `objectAsync` has the same `optionalKeys` parity (runtime and type), so a faithful-mode async object is usable as a `discriminatedUnionAsync` member.

  The mode is opt-in and travels with the schema (no global state). It is off by default, so existing `object()`/`objectAsync()` schemas keep the current `k: T | undefined` type, the `undefined`-materializing runtime output, and the current generated type, byte-for-byte. The option is passed as a non-positional object, so it does not collide with the existing trailing `message` argument; `object(entries, "message")` is unchanged. `ObjectSchema`/`ObjectSchemaAsync` and `InferObjectOutput`/`InferObjectOutputAsync` gain a defaulted type parameter for the mode. The omittable type is produced only for a literal `true`; a widened `boolean` resolves to the legacy required-key type so the static type never claims a key is omittable when the runtime value might keep it.

- 830eca4: Add an opt-in codegen mode that preserves named aliases for non-recursive sibling schemas (issue #22).

  With `codegen: { nameSharedSchemas: true }`, a non-recursive named `export const` tskm schema is emitted as its own `export type` alias and referenced by name from other generated types, instead of being inlined at every reference site. A sub-schema shared across many members of a discriminated union is then named once and referenced, rather than re-expanded per member.

  The mode routes non-recursive tskm schemas through the structural worker so the walker can resolve sibling references to alias names. External (non-tskm) schemas never enter the worker. It is off by default, so output stays byte-identical to the inline form and the zero-cost checker path is preserved for non-recursive projects (enabling it spawns the worker for files that previously skipped it). The existing fail-closed prune and duplicate-name guards carry over unchanged.

  Two fail-closed cases are tightened so the mode never ships a worse type than the checker would: a schema the structural walker cannot type (a `fallback()`, or any kind it does not handle) falls back to the checker type instead of overwriting it with `unknown`, and a bare alias cycle (a top-level mutual `lazy` that would emit `type A = B; type B = A`) is dropped in favor of the checker type rather than emitting a non-compiling sidecar.

- 830eca4: Add an explicit unknown-key policy for `object` (issue #16): `strip` (default), `exact`, and `passthrough`.

  - `strip` (unchanged default): undeclared keys are dropped, exactly as before.
  - `exactObject(entries)` (and `exactObjectAsync`): an undeclared key produces a path-precise issue, so a discriminated-union member becomes sound (a loose member no longer absorbs input meant for a stricter one). Also available as `object(entries, { rest: "exact" })`.
  - `object(entries, { rest: "passthrough" })`: undeclared keys are copied onto the output, so a downstream `transform` can still read data the schema did not enumerate.

  The policy travels on the schema as `rest`. The runtime adds a post-entries pass over the input's own keys (honoring `abortEarly` in `exact` mode); `objectAsync` gets the analogous treatment. The compiler reflects the policy in JSON Schema: `additionalProperties: false` for `strip`/`exact`, `true` for `passthrough`. The TypeScript output type stays the closed shape for every mode (passthrough's extra keys are a safe under-description). Off by default, so existing `object(entries)` schemas are byte-identical.

- 830eca4: Add an optional key-schema argument to `record` (issue #19): `record(key, value)` constrains the dictionary keys, while `record(value)` is unchanged.

  - Runtime: each key is validated through the key schema (a `picklist`, a `templateLiteral`, a `regex`-piped string, etc.), with a malformed key rejected and the offending key on the issue path. `record(value, message?)` keeps working; the two forms are disambiguated by whether the second argument is a schema (keyed) or a string (message), with no colliding positional.
  - Types: `RecordSchema` is parameterized over the key schema, so the inferred key type is `InferOutput<TKey>` instead of `string`. A `templateLiteral` key yields a templated index signature, a `picklist` key yields a finite literal key set. A `regex`-piped key outputs plain `string`, so its pattern cannot be expressed as a TypeScript key type: the inferred and emitted key type stays an unconstrained `string`, while the pattern is enforced at runtime and carried into JSON Schema as `propertyNames.pattern`. That is a limitation of TS string types, not a runtime gap.
  - Compiler: the structural emitter renders the key position from the key schema, emitting `` { [key: `item_${string}`]: V } `` for a template-literal key (and degrading a finite literal key set to `Record<K, V>`). JSON Schema constrains keys via `propertyNames`.

  - Async parity: `recordAsync(value)` / `recordAsync(key, value)` mirrors `record` and awaits async key and value schemas, so a record of async-validated values is expressible. It carries the same key-type fidelity, partial output type, and `__proto__`-safe key writes, and is exercised by the Standard Schema conformance harness.

  Additive: the single-argument `record(value)` keeps its signature, runtime behavior, and emitted `{ [key: string]: V }` type.

- 830eca4: Add a `templateLiteral` value schema (issue #18). `templateLiteral([...parts])` validates a string against a known structural shape and carries enough structure for the compiler to emit a real TypeScript template literal type, instead of widening to `string` the way `pipe(string(), regex(...))` does.

  - Parts are fixed string segments and placeholder schemas (`string()`, `number()`, a `picklist`/`literal` of tags, etc.). The runtime matches the input against the concatenation pattern; the output type folds the parts into a `` `${...}` `` template literal type, so a `picklist` placeholder distributes the union and a constrained string keeps its constrained type next to a discriminant.
  - The compiler emits the faithful template literal type in the structural TypeScript walker, and a `{ type: "string", pattern, "x-tskm-template": ... }` approximation in the JSON Schema walker.
  - The `number`/`bigint` placeholders match the hex/binary/octal integer forms (`0x10`, `0b10`, `0o17`) as well as the decimal/exponent forms, since those radix strings are members of `` `${number}` ``/`` `${bigint}` ``; the runtime no longer rejects a radix string the emitted type accepts.
  - A placeholder whose runtime match cannot be kept faithful to its inferred type fails at construction instead of diverging silently. This covers a transforming pipe placeholder (its output type differs from the base schema the regex is built from), a non-finite numeric literal, and an unbounded placeholder kind. A placeholder must also be one of tskm's own schemas: its identity is checked, so a forged or foreign object claiming a known type it does not implement is rejected rather than trusted.

  Additive: a new factory and export, one new case in each walker. Existing `pipe(string(), regex(...))` usages are unchanged.

## 0.3.0

### Minor Changes

- b61e04a: Import-independent `recursive()` detection: a `recursive()` root reached through a re-export hub (anti-corruption layer) is now materialized without an `Infer` marker.

  - Discovery treats a `recursive` named import from ANY configured `schemaSource` as a structural-walker candidate, not only a direct `@tskm/core` import. Add your hub to `schemaSources` and a `recursive()` root authored against it routes to the walker by name. (`recursive` is a tskm-specific export name, so zod/valibot/arktype are unaffected.)
  - The import scan is now only a hint; the structural worker is the routing authority. It confirms the runtime value is a tskm `recursive()` (its `~standard.vendor` is `"tskm"`) before walking, so a value that turns out not to be one is skipped with a diagnostic rather than emitted. This also closes a latent hole where a foreign value carrying `type: "recursive"` could produce an empty alias.
  - Unchanged: direct `@tskm/core` imports, `Infer` markers, external-library recursion, and the cross-file fail-closed contract (a declared root referencing an imported recursive child still skips). Helper-built, namespace, and non-`recursive` re-export shapes still need an explicit `Infer` marker.

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
