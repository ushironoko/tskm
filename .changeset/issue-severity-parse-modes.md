---
"@tskm/core": minor
---

Add issue severity, a transform diagnostic channel, and `reject`/`report` parse modes (issue #21).

- Issues carry an optional `severity: "error" | "warning"` (absent means `"error"`). Success is now decided by the absence of any error-severity issue rather than the absence of any issue, so a parse that produces only warnings succeeds. `safeParse` / `safeParseAsync` carry the warnings on a new `warnings` field. Severity is internal and never crosses the Standard Schema boundary; a warning is not a Standard Schema failure, so warnings are excluded from the external `issues` array.
- `transform` / `transformAsync` operations receive a second `ctx` argument whose `ctx.issue(message, severity?)` records a diagnostic without throwing and without closure-captured state. A `"warning"` is reported but keeps the parse successful; an `"error"` fails it. Existing `(input) => output` operations are unchanged.
- `Config` gains a `mode: "reject" | "report"` setting. `reject` bails at the first error (the fast acceptance gate); `report` (the default) collects every issue. `abortEarly: true` remains valid as the back-compat alias for `reject`.

The two-stage union diagnostic (select a member by discriminator, then collect its in-member violations) is provided by `discriminatedUnion`. All changes are additive: severity defaults to `"error"`, the default mode reproduces today's collect-all behavior, and a schema that never emits warnings sees unchanged results.
