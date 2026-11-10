---
"@tskm/compiler": minor
---

`tskm json-schema` fails closed on Standard Schema conversion failures, stale output, and non-finite numbers.

- A zod, valibot, or arktype schema whose converter fails now fails its file, as a tskm type the walker cannot express does. Nothing is written for the file, the error names the export and the vendor, and the command exits with code 1. It used to print a warning, and the file was written without that export. Vendor schemas have no approximation.
- When a schema module produces no document in a run, its previous output is deleted, and the CLI prints a `removed` line. It used to stay on disk for downstream tools to read. A source with no schema exports is never touched. A module that does not load keeps its previous output, with a `may be out of date` warning, and the exit code does not change. `generateJsonSchema()` returns `removed`.
- `NaN`, `Infinity`, and `-Infinity` in a `literal`, a picklist option, or a numeric bound (`minValue`, `maxValue`, `multipleOf`, the length checks) fail the file. They used to be written as `null`. The new `nonfinite` name in `jsonSchema.approximate` (or `--approximate nonfinite`) approximates them: a literal becomes a schema no JSON value matches, an option is dropped, and a bound is omitted. A bigint, `Date`, or string used as a bound fails the file, even with an approximation listed.
- zod and valibot refuse a non-finite literal and enum member through their own converter hooks. Valibot schemas now honor `jsonSchema.io: "input"`. A missing `outDir` is created instead of crashing the run.
