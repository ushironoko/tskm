---
"@tskm/vite": patch
---

Fix `vite dev` compiling schemas twice on startup and then ignoring file changes.

The dev server starts the compiler watcher, which already generates once, and `buildStart` generated again. Dev startup now leaves that first pass to the watcher. `vite build` still generates once from `buildStart`. The watcher is no longer closed by the function `configureServer` returns, because Vite calls that function during startup, before `listen`.
