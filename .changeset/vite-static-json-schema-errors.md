---
"@tskm/compiler": patch
"@tskm/vite": patch
---

Report static JSON Schema failures from the Vite plugin. An incremental watch rebuild keeps those errors on the generate result, and the plugin prints them as errors so a removed literal is not a silent success.
