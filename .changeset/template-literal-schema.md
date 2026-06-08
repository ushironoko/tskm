---
"@tskm/core": minor
"@tskm/compiler": minor
---

Add a `templateLiteral` value schema (issue #18). `templateLiteral([...parts])` validates a string against a known structural shape and carries enough structure for the compiler to emit a real TypeScript template literal type, instead of widening to `string` the way `pipe(string(), regex(...))` does.

- Parts are fixed string segments and placeholder schemas (`string()`, `number()`, a `picklist`/`literal` of tags, etc.). The runtime matches the input against the concatenation pattern; the output type folds the parts into a `` `${...}` `` template literal type, so a `picklist` placeholder distributes the union and a constrained string keeps its constrained type next to a discriminant.
- The compiler emits the faithful template literal type in the structural TypeScript walker, and a `{ type: "string", pattern, "x-tskm-template": ... }` approximation in the JSON Schema walker.

Additive: a new factory and export, one new case in each walker. Existing `pipe(string(), regex(...))` usages are unchanged.
