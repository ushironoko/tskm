---
"@tskm/core": minor
"@tskm/compiler": minor
---

Add a `templateLiteral` value schema (issue #18). `templateLiteral([...parts])` validates a string against a known structural shape and carries enough structure for the compiler to emit a real TypeScript template literal type, instead of widening to `string` the way `pipe(string(), regex(...))` does.

- Parts are fixed string segments and placeholder schemas (`string()`, `number()`, a `picklist`/`literal` of tags, etc.). The runtime matches the input against the concatenation pattern; the output type folds the parts into a `` `${...}` `` template literal type, so a `picklist` placeholder distributes the union and a constrained string keeps its constrained type next to a discriminant.
- The compiler emits the faithful template literal type in the structural TypeScript walker, and a `{ type: "string", pattern, "x-tskm-template": ... }` approximation in the JSON Schema walker.
- The `number`/`bigint` placeholders match the hex/binary/octal integer forms (`0x10`, `0b10`, `0o17`) as well as the decimal/exponent forms, since those radix strings are members of `` `${number}` ``/`` `${bigint}` ``; the runtime no longer rejects a radix string the emitted type accepts.
- A placeholder whose runtime match cannot be kept faithful to its inferred type fails at construction instead of diverging silently. This covers a transforming pipe placeholder (its output type differs from the base schema the regex is built from), a non-finite numeric literal, and an unbounded placeholder kind. A placeholder must also be one of tskm's own schemas: its identity is checked, so a forged or foreign object claiming a known type it does not implement is rejected rather than trusted.

Additive: a new factory and export, one new case in each walker. Existing `pipe(string(), regex(...))` usages are unchanged.
