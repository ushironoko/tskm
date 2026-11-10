---
"@tskm/compiler": patch
---

Fix `watch()` running one extra generate on Node after a source was written just before `watch()` started, when another file watcher was open on the same directory. Watch now decides whether a source changed by comparing its content with the content its output was generated from, not by the file-system event. A rewrite with identical bytes no longer regenerates (on Node and Bun), a real edit still does, and the compiler's own sidecar and inplace writes still don't trigger a pass.
