# @tskm/core

## 0.2.1

### Patch Changes

- dfcb2a7: Add an opt-in, experimental compiled validation fast path (Tier-0, no eval). `safeParseCompiled` compiles a schema into a closure tree at construction time, with no `eval`, `new Function`, or codegen, so it runs under a strict CSP and on edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge) where JIT codegen is blocked.

  - It removes the interpreter's megamorphic per-node dispatch and per-value dataset allocation, winning roughly 1.1x to 2.4x on container schemas across both V8 and JSC, while staying byte-identical to `safeParse` on both success and error paths.
  - The interpreter stays the single source of truth. Piped, async, and non-specialized nodes fall back to `~run`, and specialization dispatches on factory identity (`schema.reference`), so a foreign schema with a colliding `type` string keeps running its own `~run`.
  - New exports are `safeParseCompiled`, `getCompiledValidate`, and the `Cursor` and `Step` types. A bare top-level primitive should keep using `safeParse` directly.

## 0.2.0

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

- 830eca4: Add issue severity, a transform diagnostic channel, and `reject`/`report` parse modes (issue #21).

  - Issues carry an optional `severity: "error" | "warning"` (absent means `"error"`). Success is now decided by the absence of any error-severity issue rather than the absence of any issue, so a parse that produces only warnings succeeds. `safeParse` / `safeParseAsync` carry the warnings on a new `warnings` field. Severity is internal and never crosses the Standard Schema boundary; a warning is not a Standard Schema failure, so warnings are excluded from the external `issues` array.
  - `transform` / `transformAsync` operations receive a second `ctx` argument whose `ctx.issue(message, severity?)` records a diagnostic without throwing and without closure-captured state. A `"warning"` is reported but keeps the parse successful; an `"error"` fails it. Existing `(input) => output` operations are unchanged.
  - `Config` gains a `mode: "reject" | "report"` setting. `reject` bails at the first error (the fast acceptance gate); `report` (the default) collects every issue. `abortEarly: true` remains valid as the back-compat alias for `reject`.

  The two-stage union diagnostic (select a member by discriminator, then collect its in-member violations) is provided by `discriminatedUnion`. All changes are additive: severity defaults to `"error"`, the default mode reproduces today's collect-all behavior, and a schema that never emits warnings sees unchanged results.

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

- 830eca4: Surface `~standard.types` as a present, type-level carrier so inferred types are readable from a validator value (issue #20). A tskm schema now exposes its input/output through `(typeof schema)["~standard"]["types"]["output"]` without a `NonNullable` step.

  - `~standard.types` is now typed as present rather than the spec's optional form, so the vendor-neutral query resolves directly. This is type-level only: the runtime `~standard` object is unchanged and still exposes only `version`, `vendor`, and `validate`. The convergence with other Standard Schema vendors is in how the value is read at runtime; the spec and those vendors keep `types` optional, so this present typing is an intentional ergonomic choice at the type level. Because the present form removes the optional check, `~standard.types` must be used only as a type, never read as a runtime value.
  - `InferInput` / `InferOutput` (and `Infer`) now read this single canonical marker. The internal, never-populated `~types` marker and its `SchemaTypes` type are removed; inference results are unchanged.
  - Public type-surface note: `BaseSchema` and `BaseSchemaAsync` are exported, so two changes to them are observable to consumers, even though no runtime or inference result changes: the `~types?` member is removed, and `~standard.types` narrows from optional to required. The new `StandardProps` type is exported.
  - The compiler's existing `NonNullable<(typeof x)["~standard"]["types"]>["output"]` query resolves to the same type as before, so emitted types are unaffected.

- 830eca4: Add a `templateLiteral` value schema (issue #18). `templateLiteral([...parts])` validates a string against a known structural shape and carries enough structure for the compiler to emit a real TypeScript template literal type, instead of widening to `string` the way `pipe(string(), regex(...))` does.

  - Parts are fixed string segments and placeholder schemas (`string()`, `number()`, a `picklist`/`literal` of tags, etc.). The runtime matches the input against the concatenation pattern; the output type folds the parts into a `` `${...}` `` template literal type, so a `picklist` placeholder distributes the union and a constrained string keeps its constrained type next to a discriminant.
  - The compiler emits the faithful template literal type in the structural TypeScript walker, and a `{ type: "string", pattern, "x-tskm-template": ... }` approximation in the JSON Schema walker.
  - The `number`/`bigint` placeholders match the hex/binary/octal integer forms (`0x10`, `0b10`, `0o17`) as well as the decimal/exponent forms, since those radix strings are members of `` `${number}` ``/`` `${bigint}` ``; the runtime no longer rejects a radix string the emitted type accepts.
  - A placeholder whose runtime match cannot be kept faithful to its inferred type fails at construction instead of diverging silently. This covers a transforming pipe placeholder (its output type differs from the base schema the regex is built from), a non-finite numeric literal, and an unbounded placeholder kind. A placeholder must also be one of tskm's own schemas: its identity is checked, so a forged or foreign object claiming a known type it does not implement is rejected rather than trusted.

  Additive: a new factory and export, one new case in each walker. Existing `pipe(string(), regex(...))` usages are unchanged.

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
