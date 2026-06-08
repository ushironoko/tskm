---
"@tskm/core": minor
---

Surface `~standard.types` as a present, type-level carrier so inferred types are readable from a validator value (issue #20). A tskm schema now exposes its input/output through `(typeof schema)["~standard"]["types"]["output"]` without a `NonNullable` step.

- `~standard.types` is now typed as present rather than the spec's optional form, so the vendor-neutral query resolves directly. This is type-level only: the runtime `~standard` object is unchanged and still exposes only `version`, `vendor`, and `validate`. The convergence with other Standard Schema vendors is in how the value is read at runtime; the spec and those vendors keep `types` optional, so this present typing is an intentional ergonomic choice at the type level. Because the present form removes the optional check, `~standard.types` must be used only as a type, never read as a runtime value.
- `InferInput` / `InferOutput` (and `Infer`) now read this single canonical marker. The internal, never-populated `~types` marker and its `SchemaTypes` type are removed; inference results are unchanged.
- Public type-surface note: `BaseSchema` and `BaseSchemaAsync` are exported, so two changes to them are observable to consumers, even though no runtime or inference result changes: the `~types?` member is removed, and `~standard.types` narrows from optional to required. The new `StandardProps` type is exported.
- The compiler's existing `NonNullable<(typeof x)["~standard"]["types"]>["output"]` query resolves to the same type as before, so emitted types are unaffected.
