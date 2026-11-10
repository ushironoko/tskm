---
"@tskm/compiler": minor
---

Shared object types are written by name in the generated `*.gen.ts`, instead of being expanded at every use site.

When a part of a schema's type prints exactly like another exported object schema's type in the same module, the sidecar writes that schema's name. With `addressSchema` exported and used by `userSchema`, `User` reads `address: Address`, and `Address` is declared once. A discriminated union with exported members reads `Home | Work`. Only identical text is replaced, so every generated type means what it meant before.

Two parts stay inline, on purpose. A part from another module stays inline, because naming it would import from that module's sidecar, which may not exist or may be pruned. A name is never written where it would clash with an identifier the sidecar imports (valibot's `Brand`, or the annotation type of a recursive external schema), so no new import is ever needed.

Recursive schemas spell their objects like the rest of the output now, with `;` after every member. That is a formatting change in recursive sidecars only.

This is a minor release, not a patch: every project that shares object parts gets a different default `*.gen.ts` (the same types, written by name), and the recursive sidecar format changes spelling. No generated type changes meaning. `codegen.nameSharedSchemas` is unchanged and still opt-in.
