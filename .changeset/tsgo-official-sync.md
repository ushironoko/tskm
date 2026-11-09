---
"@tskm/compiler": minor
---

Drive the checker through TypeScript's `typescript/sync` API instead of `@corsa-bind/napi` and the pinned `@typescript/native-preview` binary.

Query documents are an in-memory file-system overlay, so a generate run no longer writes `*.tskm-query.ts`. `@tskm/compiler` now peer-depends on `typescript` `>=7.1.0-beta <8`. The 7.0 `typescript/unstable/sync` surface is not adapted: its snapshot and virtual filesystem are a different client, not an import-path change. `node` stays `>=22`.
