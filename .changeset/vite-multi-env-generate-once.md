---
"@tskm/vite": patch
---

Generate schemas once when Vite builds more than one environment.

`buildApp` runs `buildStart` for each environment, so a client and ssr build compiled the project twice. Environments that have not generated yet share that pass. The same environment's next build, including a `build --watch` rebuild of only that environment, compiles again. A file change that rebuilds client and ssr together still compiles once.
