---
"@tskm/vite": patch
---

Generate schemas once when Vite builds more than one environment.

`buildApp` runs `buildStart` for each environment, so a client and ssr build compiled the project twice. Those hooks now share one `generate()`. A later `build()`, and each rebuild from `build --watch`, still compiles.
