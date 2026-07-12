---
"@tskm/core": minor
"@tskm/compiler": patch
---

Add a `description(text)` metadata action and map it to the JSON Schema `description` keyword

`description()` is a pure pass-through transformation (no runtime validation effect, same shape as `readonly`). The JSON Schema emitter now folds it onto the accumulated schema as the `description` keyword; piping it multiple times is last-wins. Per-property descriptions inside `object()` land on the property schema.
