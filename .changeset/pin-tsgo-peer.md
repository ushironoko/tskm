---
"@tskm/compiler": minor
---

Pin `@typescript/native-preview` to exactly `7.0.0-dev.20260707.2` and bump `@corsa-bind/napi` to `1.15.0`.

The peerDependency was an open lower bound (`>=7.0.0-dev.20260601.1`), which allowed installs to resolve `7.0.0-dev.20260604.1` and later builds where `openProject` fails. The peer is now an exact version so those builds cannot be selected. `@corsa-bind/napi` moves from `0.35.0` to `1.15.0`.

Exact peer makes npm ERESOLVE for installs still on `7.0.0-dev.20260601.1` through `7.0.0-dev.20260603.1`, so this is a minor bump in 0.x. Upgrade `@typescript/native-preview` to `7.0.0-dev.20260707.2`.
