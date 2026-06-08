---
"@tskm/compiler": minor
---

Import-independent `recursive()` detection: a `recursive()` root reached through a re-export hub (anti-corruption layer) is now materialized without an `Infer` marker.

- Discovery treats a `recursive` named import from ANY configured `schemaSource` as a structural-walker candidate, not only a direct `@tskm/core` import. Add your hub to `schemaSources` and a `recursive()` root authored against it routes to the walker by name. (`recursive` is a tskm-specific export name, so zod/valibot/arktype are unaffected.)
- The import scan is now only a hint; the structural worker is the routing authority. It confirms the runtime value is a tskm `recursive()` (its `~standard.vendor` is `"tskm"`) before walking, so a value that turns out not to be one is skipped with a diagnostic rather than emitted. This also closes a latent hole where a foreign value carrying `type: "recursive"` could produce an empty alias.
- Unchanged: direct `@tskm/core` imports, `Infer` markers, external-library recursion, and the cross-file fail-closed contract (a declared root referencing an imported recursive child still skips). Helper-built, namespace, and non-`recursive` re-export shapes still need an explicit `Infer` marker.
