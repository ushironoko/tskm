# @tskm/compiler

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
