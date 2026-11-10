---
"@tskm/compiler": minor
---

Shared object types are written by name in the generated output, instead of being expanded at every use site.

When a part of a schema's type prints exactly like another exported object schema's type in the same module, the output writes that schema's name. With `addressSchema` exported and used by `userSchema`, `User` reads `address: Address`, and `Address` is declared once. A discriminated union with exported members reads `Home | Work`. Only identical text is replaced. A literal that appears twice in one member's type, such as `A | A` or `[A, A]`, stays written out, because TypeScript would merge the two copies into one type.

Two parts stay inline, on purpose. A part from another module stays inline, because naming it would import from that module's sidecar, which may not exist or may be pruned. A name is never written where it would clash with an identifier the sidecar imports (valibot's `Brand`, or the annotation type of a recursive external schema), so no new import is ever needed.

The change reaches three kinds of output:

- Sidecars (`*.gen.ts`) of every project that shares object parts.
- Recursive sidecars and `codegen.nameSharedSchemas` sidecars, which now put a `;` after every object member. That is a formatting change only.
- In `inplace` mode, the upgrade rewrites each changed region of your source file once. A later run changes nothing.

This is a minor release, not a patch. No generated type changes meaning. To keep the previous output byte for byte, set `codegen: { namedParts: false }`. `codegen.nameSharedSchemas` is unchanged and still opt-in.
