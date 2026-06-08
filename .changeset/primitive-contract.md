---
---

Define the cross-cutting contract for new schema primitives (issue #23) and add the conformance/interop test harness the per-primitive issues reference. No published surface changes, so this carries no version bump.

- `docs/primitive-contract.md`: the normative per-primitive checklist (Standard Schema contract, JSON Schema mapping table, async parity, semver/factory rules, i18n design, interop).
- A reusable Standard Schema conformance harness that enforces sync/async parity and a strict `{ message, path? }` issue allowlist, so no internal diagnostic field leaks across the `~standard` boundary.
- A compiler walker switch-table parity test that fails when `structural-ts.ts` and `jsonschema.ts` disagree on the set of `schema.type` cases they handle.
- A runtime interop test driving a tskm schema and a `valibot` schema through one generic Standard Schema consumer.
