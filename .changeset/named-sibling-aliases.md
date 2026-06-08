---
"@tskm/compiler": minor
---

Add an opt-in codegen mode that preserves named aliases for non-recursive sibling schemas (issue #22).

With `codegen: { nameSharedSchemas: true }`, a non-recursive named `export const` tskm schema is emitted as its own `export type` alias and referenced by name from other generated types, instead of being inlined at every reference site. A sub-schema shared across many members of a discriminated union is then named once and referenced, rather than re-expanded per member.

The mode routes non-recursive tskm schemas through the structural worker so the walker can resolve sibling references to alias names. External (non-tskm) schemas never enter the worker. It is off by default, so output stays byte-identical to the inline form and the zero-cost checker path is preserved for non-recursive projects (enabling it spawns the worker for files that previously skipped it). The existing fail-closed prune and duplicate-name guards carry over unchanged.
