# Primitive contract

This document fixes the shared requirements every new schema primitive or mode must satisfy. It exists so the per-primitive issues reference one settled contract instead of re-deriving these boundaries independently. The issues it covers are a key-typed `record`, an exact object, a `templateLiteral`, a `discriminatedUnion`, optional-property fidelity, a present `~standard.types` carrier, and the diagnostics work.

Each requirement below names the test that checks it, so the contract is enforced rather than only described. Enforcement is per-primitive: a requirement holds for a primitive once that primitive is added to the relevant check. A new primitive that is never added to those checks passes the suite without proving anything, so adding it to the checks is part of landing it.

## 1. Standard Schema contract

The Standard Schema v1 interface is vendored verbatim in `packages/tskm/src/types/standard.ts`, so the external surface is fixed. Every primitive must hold to it:

- `~standard.validate` returns a plain result for a sync schema and a `Promise` for an async one. It never mixes the two for one schema.
- `~standard.types` is a present, type-level-only carrier of `input` and `output`. It exposes those two members and no other. It is absent at runtime (the runtime `~standard` object stays `version`/`vendor`/`validate`), so it must never be read as a runtime value. A primitive must keep this carrier shape and add no other member.
- The external `Issue` stays exactly `{ message, path? }`. The rich internal issue (`kind`, `type`, `expected`, `received`, `input`, and any future severity-like field) must never cross the `_getStandardProps` boundary.

The boundary is the strict allowlist in the conformance harness. The harness rejects any key on a returned issue other than `message` and `path`, so a new internal field cannot leak even by accident.

Note for the diagnostics work (severity, warnings, report mode): a severity-like field lives on the internal issue only. The projection in `toStandardIssue` keeps dropping everything except `message` and `path`. The harness allowlist is the regression guard for that drop, so the diagnostics work co-designs its field names against this allowlist rather than relaxing it.

Enforced by `packages/tskm/test/standard-contract.test.ts` via `assertStandardSchemaConformance`.

## 2. JSON Schema mapping

The emitter is a duck-typed walker (`packages/compiler/src/jsonschema.ts`). The standard emission for each new primitive is fixed here. Anything richer than the standard form is an approximation plus a vendor extension, never a silent change to an existing case.

| Primitive | Standard JSON Schema form |
| --- | --- |
| template literal | `pattern` approximation, with the literal structure carried as a vendor extension |
| key-typed `record(key, value)` | `propertyNames` constraining the key (a pattern for a `templateLiteral` key, an enum for a `picklist` key) plus `additionalProperties` for the value |
| exact (closed) object | `additionalProperties: false` (already the `object` default) |
| discriminated union | `oneOf` with `const` on the discriminant, the discriminant key surfaced as an option or vendor extension |

Two walkers read the same runtime schema graph: the JSON Schema walker and the structural TypeScript walker (`packages/compiler/src/structural-ts.ts`). A primitive that introduces a new `schema.type` case must add it to both walkers in the same change. If only one walker learns a case, the other falls through to its default branch and silently emits `{}` or `unknown` or `additionalProperties: false`.

`packages/compiler/test/walker-parity.test.ts` fails when the two walkers disagree on the set of top-level `schema.type` cases they handle. It guards new schema-type cases such as `discriminatedUnion` and `templateLiteral`. A primitive that folds into an existing case instead of adding one, for example an object unknown-key mode or the `record` key argument, does not change that set, so the parity test does not cover it. Such a primitive adds its own walker-branch test exercising both walkers.

## 3. Async parity

Sync and async are separate parallel surfaces (`object` and `objectAsync`, `union` and `unionAsync`, `array` and `arrayAsync`). Design every new primitive on both paths in the same change so the two surfaces do not diverge into a double specification.

If a primitive genuinely cannot exist on the async path, say so in its own issue and in its doc comment. Silence is not an allowed answer.

Both paths run through the same conformance harness: the sync case asserts a synchronous result, the async case asserts a `Promise`, and both assert the same `{ message, path? }` projection.

## 4. Semver and factory signatures

Breaking changes default off. New primitives are new exports, so they are additive by construction.

The existing factories take one argument plus an optional trailing `message` (`record(value, message?)`, `union(options, message?)`). Adding a second positional argument is ambiguous against that trailing `message`. Resolve the ambiguity without a second positional:

- prefer a distinct named factory, for example a separate `exactObject` rather than a mode flag squeezed into `object`'s positional list, or
- prefer an options-object argument where a positional addition would otherwise break type inference.

`record`'s added key argument follows this rule: it does not become a second positional that collides with the trailing `message`.

## 5. Messages and i18n

Default messages are built inline in `packages/tskm/src/utils/_addIssue.ts` from `kind`, `type`, `expected`, and `received`. A schema-kind failure uses a generic `type` label, while a validation failure uses its specific `type`. Each schema accepts a single optional `message` override. There is no global mutable configuration and `Config` is intentionally minimal.

Each new primitive ships a default message consistent with that inline construction. Message resolution stays a passed-in hook rather than ambient state: a resolver is threaded through the call, never read from a global.

This section is a design constraint, not an implemented hook. The hook lands with the diagnostics work. New primitives until then keep using the existing inline default plus the single `message` override, so they remain compatible once the hook exists.

## 6. Interop

Type-level conformance against the real `@standard-schema/spec` package is already asserted in the type tests. A primitive also needs runtime interop proof:

- it is consumable by a generic Standard Schema consumer that knows only the spec, and
- the same generic consumer accepts a schema from at least one other Standard Schema library, so the consumer is genuinely validator-agnostic and tskm conforms to the same contract.

Enforced by `packages/tskm/test/interop.test.ts`, which runs a tskm schema and a `valibot` schema through one shared consumer.

## Per-primitive checklist

A new primitive issue is complete when all of these hold:

1. The schema exists on both the sync and async paths, or its issue states why it cannot.
2. It passes `assertStandardSchemaConformance`, including the strict `{ message, path? }` allowlist.
3. Both walkers handle its `schema.type`, and `walker-parity.test.ts` stays green.
4. Its JSON Schema emission matches the table in section 2, with anything richer carried as a vendor extension.
5. Its factory signature follows section 4 (no colliding second positional).
6. It ships a default message and routes overrides through the single `message` argument.
7. It appears in the interop test, consumable through the generic consumer.
