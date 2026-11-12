---
"@tskm/core": minor
"@tskm/compiler": minor
---

Add opt-in static Standard JSON Schema. `jsonSchema.emit: "standard"` writes per-target JSON literals into the sidecar, and `withStaticJsonSchema` serves them from `~standard.jsonSchema` without the runtime walker.
