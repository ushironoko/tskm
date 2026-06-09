---
"@tskm/core": minor
"@tskm/compiler": minor
---

Add an optional key-schema argument to `record` (issue #19): `record(key, value)` constrains the dictionary keys, while `record(value)` is unchanged.

- Runtime: each key is validated through the key schema (a `picklist`, a `templateLiteral`, a `regex`-piped string, etc.), with a malformed key rejected and the offending key on the issue path. `record(value, message?)` keeps working; the two forms are disambiguated by whether the second argument is a schema (keyed) or a string (message), with no colliding positional.
- Types: `RecordSchema` is parameterized over the key schema, so the inferred key type is `InferOutput<TKey>` instead of `string`. A `templateLiteral` key yields a templated index signature, a `picklist` key yields a finite literal key set. A `regex`-piped key outputs plain `string`, so its pattern cannot be expressed as a TypeScript key type: the inferred and emitted key type stays an unconstrained `string`, while the pattern is enforced at runtime and carried into JSON Schema as `propertyNames.pattern`. That is a limitation of TS string types, not a runtime gap.
- Compiler: the structural emitter renders the key position from the key schema, emitting `` { [key: `item_${string}`]: V } `` for a template-literal key (and degrading a finite literal key set to `Record<K, V>`). JSON Schema constrains keys via `propertyNames`.

Additive: the single-argument `record(value)` keeps its signature, runtime behavior, and emitted `{ [key: string]: V }` type.
