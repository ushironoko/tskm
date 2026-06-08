---
"@tskm/core": minor
"@tskm/compiler": minor
---

Add a `discriminatedUnion` schema with O(1) tag dispatch and discriminant metadata (issue #15), plus an async `discriminatedUnionAsync` variant.

- `discriminatedUnion(discriminantKey, members)` builds a tag-to-member lookup once, at construction time, and on parse selects and validates only the single member named by the input's discriminant. No other member is touched, so a deep recursive tagged union parses in time proportional to the realized input shape rather than re-validating wrong branches at every level.
- The discriminant is authoritative: a missing key, a non-object input, or an unknown tag produces a precise issue instead of falling through to a permissive member. In-member violations are still reported with the member's paths.
- The discriminant key and the full tag set are exposed on the schema value as `schema.discriminant` and `schema.literals`, so a tag-keyed registry can be derived from the schema as the single source of truth. Misuse (a member missing the discriminant, a non-literal discriminant, or a duplicate tag) is a construction-time error.
- The compiler emits a tag-narrowing union in the structural TypeScript walker and `oneOf` with the discriminant as `const` in the JSON Schema walker.

Additive: `union`/`unionAsync` and their emission paths are unchanged; the new schema is a separate `"discriminated_union"` type with its own exports.
