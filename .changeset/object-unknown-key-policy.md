---
"@tskm/core": minor
"@tskm/compiler": minor
---

Add an explicit unknown-key policy for `object` (issue #16): `strip` (default), `exact`, and `passthrough`.

- `strip` (unchanged default): undeclared keys are dropped, exactly as before.
- `exactObject(entries)` (and `exactObjectAsync`): an undeclared key produces a path-precise issue, so a discriminated-union member becomes sound (a loose member no longer absorbs input meant for a stricter one). Also available as `object(entries, { rest: "exact" })`.
- `object(entries, { rest: "passthrough" })`: undeclared keys are copied onto the output, so a downstream `transform` can still read data the schema did not enumerate.

The policy travels on the schema as `rest`. The runtime adds a post-entries pass over the input's own keys (honoring `abortEarly` in `exact` mode); `objectAsync` gets the analogous treatment. The compiler reflects the policy in JSON Schema: `additionalProperties: false` for `strip`/`exact`, `true` for `passthrough`. The TypeScript output type stays the closed shape for every mode (passthrough's extra keys are a safe under-description). Off by default, so existing `object(entries)` schemas are byte-identical.
