---
"@tskm/compiler": minor
---

Standard Schema generic compilation: zod / valibot / arktype schemas are now AOT type sources.

- Hybrid discovery: syntactic candidates from `schemaSources` (NEW config, **default `["zod", "valibot", "arktype"]`** — `@tskm/core` is always implicit; pass `[]` to opt out), confirmed by an any-guarded `~standard` checker probe. **Behavior expansion**: a project that already imports zod/valibot/arktype will start generating sidecars for those schemas after this update.
- The resolver queries `NonNullable<(typeof x)["~standard"]["types"]>["output"]` — one structural expression for every vendor (tskm included; existing output is byte-identical) — with a raw/prettify dual rendering that also fixes the previous top-level `Date`/`Map`/`Set` prototype explosion.
- Generated sidecars import what their types reference: vendor brand markers (`$brand` from zod, `Brand` from valibot) and exported self-annotation types of recursive schemas — an aliased re-export (`export { type CatT as PublicCat }`) is rebound on import (`import type { PublicCat as CatT }`). A non-exported annotation, or any render that would not compile, is skipped fail-closed (new pre-write compile gate) with a diagnostic; the previous output stays.
- JSON Schema gains a vendor adapter: spec 1.1 native converters (`~standard.jsonSchema` — zod 4 / arktype), `@valibot/to-json-schema` delegation (with install guidance when missing), the tskm walker, and per-schema skip diagnostics for unrepresentable types. New `jsonSchema.io` config (default `"output"`).
- The structural walker and Tier-1 are now explicitly gated to tskm schemas via per-target capability metadata (a valibot schema's `kind: "schema"` can no longer reach the tskm walker), and inplace mode reports external schemas as unsupported instead of staying silent.
- Diagnostics never go silent at the vendor boundary: JSON Schema exports excluded by the vendor allow-list surface one aggregated diagnostic per file and vendor (naming the allow-list and the package-root requirement), and a compile-gate failure now names the unresolved identifier(s) with a leak hint instead of only the TS code.
