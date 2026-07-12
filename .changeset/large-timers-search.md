---
"@tskm/core": minor
"@tskm/compiler": patch
---

Add a `description(text)` metadata action and map it to the JSON Schema `description` keyword

`description()` is the first action with the new `BaseMetadata` kind: it carries its text in `requirement`, has no `~run`, and is never executed — `pipe`/`pipeAsync` drop metadata items from the run list at construction time, so parsing is unaffected and the inferred output type is preserved without explicit type arguments. The public `PipeItem` union gains `BaseMetadata`, and `BaseMetadata` is exported.

The JSON Schema emitter folds `description` onto the accumulated schema as the `description` keyword; piping it multiple times is last-wins, and per-property descriptions inside `object()` land on the property schema.
