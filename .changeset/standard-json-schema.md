---
"@tskm/core": minor
---

Add Standard JSON Schema (`~standard.jsonSchema.input` / `output`) to every schema.

Import `@tskm/core/json-schema` to enable conversion. The walker is a separate entry, so programs that only parse values do not bundle it. Targets are `draft-2020-12`, `draft-07`, and `openapi-3.0`. `draft-2020-12` output matches the `tskm json-schema` emitter for schemas that emitter can represent. `input` and `output` differ for `preprocess` / `coerce`, JSON defaults, and `fallback`. `transform` output, `check`, `bigint`, `date`, and `undefined` throw with the reason.
