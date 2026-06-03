---
"@tskm/core": minor
"@tskm/compiler": minor
---

Materialize recursive schema types with no hand-written annotation.

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
