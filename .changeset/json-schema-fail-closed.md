---
"@tskm/compiler": minor
---

`tskm json-schema` fails closed on types JSON Schema cannot express, and approximates them only when they are listed.

`bigint`, `date`, `undefined`, a `check` predicate, and a `transform`'s output used to be emitted as approximations with a warning. They now fail their file: nothing is written for it, the error names the export, the path inside it, the type, and the option that accepts it, and the command exits with code 1. The set matches what `@tskm/core`'s `withJsonSchema` throws for.

To keep the previous output, list the types: `jsonSchema.approximate: ["bigint", "date", "undefined", "check", "transform"]` in `tskm.config.ts`, or `--approximate bigint,date` on the CLI. Each listed type emits the same stand-in as before and notes each use as a warning. Unknown names are errors, and a boolean is not accepted. For a `transform` on a request body, `jsonSchema.io: "input"` describes the input side exactly.

Other changes in this release:

- `fallback(T, v)` emits the inner `T`. It used to emit `{}`.
- `jsonSchema.io: "input"` now applies to tskm schemas: `preprocess` is `{}`, and a transform keeps the pre-transform type. It was ignored before.
- `preprocess`, `nullish`, `brand`, and `readonly` no longer print warnings, because their JSON output is exact.
- `--out` no longer drops the rest of `tskm.config.*`. The flag overrides `jsonSchema.outDir`.
- `generateJsonSchema()` returns `errors`, and a source with an error is not written. `schemaToJsonSchema()` returns `errors` as well as `warnings`.

The README section "JSON Schema: types it cannot express" lists the migration steps.
