---
"@tskm/core": patch
---

Add an opt-in, experimental compiled validation fast path (Tier-0, no eval). `safeParseCompiled` compiles a schema into a closure tree at construction time, with no `eval`, `new Function`, or codegen, so it runs under a strict CSP and on edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge) where JIT codegen is blocked.

- It removes the interpreter's megamorphic per-node dispatch and per-value dataset allocation, winning roughly 1.1x to 2.4x on container schemas across both V8 and JSC, while staying byte-identical to `safeParse` on both success and error paths.
- The interpreter stays the single source of truth. Piped, async, and non-specialized nodes fall back to `~run`, and specialization dispatches on factory identity (`schema.reference`), so a foreign schema with a colliding `type` string keeps running its own `~run`.
- New exports are `safeParseCompiled`, `getCompiledValidate`, and the `Cursor` and `Step` types. A bare top-level primitive should keep using `safeParse` directly.
