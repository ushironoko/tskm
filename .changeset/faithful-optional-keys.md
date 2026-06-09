---
"@tskm/core": minor
"@tskm/compiler": minor
---

Add a faithful optional-property mode for `object()` (issue #17). Building an object with `object(entries, { optionalKeys: true })` makes `optional` and `nullish` keys omittable across all three views of the schema, so a generated type can model the value you build rather than only the value you narrow to.

- Runtime: under the mode, a missing `optional`/`nullish` key is left absent in the parsed output instead of materialized as `undefined`. A present value (including a default) is kept; `nullish` keeps `null`.
- Type: `InferObjectOutput` gives those entries a `k?:` modifier with `undefined` stripped from the value (`nullish` keeps `null`), so `InferOutput` matches the runtime output.
- Compiler: the structural TypeScript emitter renders the same `k?:` shape from the schema graph.

`objectAsync` has the same `optionalKeys` parity (runtime and type), so a faithful-mode async object is usable as a `discriminatedUnionAsync` member.

The mode is opt-in and travels with the schema (no global state). It is off by default, so existing `object()`/`objectAsync()` schemas keep the current `k: T | undefined` type, the `undefined`-materializing runtime output, and the current generated type, byte-for-byte. The option is passed as a non-positional object, so it does not collide with the existing trailing `message` argument; `object(entries, "message")` is unchanged. `ObjectSchema`/`ObjectSchemaAsync` and `InferObjectOutput`/`InferObjectOutputAsync` gain a defaulted type parameter for the mode. The omittable type is produced only for a literal `true`; a widened `boolean` resolves to the legacy required-key type so the static type never claims a key is omittable when the runtime value might keep it.
