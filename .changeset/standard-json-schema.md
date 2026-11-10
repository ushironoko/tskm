---
"@tskm/core": minor
---

Add `withJsonSchema` (`@tskm/core/json-schema`) for Standard JSON Schema.

`withJsonSchema(schema)` returns a new object. The argument is unchanged, and `~standard.validate` plus the inferred input and output types stay the same. `jsonSchema.input` / `output` accept `draft-2020-12`, `draft-07`, and `openapi-3.0`. `draft-2020-12` output matches the `tskm json-schema` emitter for schemas that emitter can represent. `input` and `output` differ for `preprocess`, JSON defaults, and `fallback`. `transform` output, `check`, `bigint`, `date`, and `undefined` throw when conversion is called, and so do a `NaN` or infinite literal, picklist option, or numeric bound, and a bound that is not a number. The main `@tskm/core` entry does not include the walker.
