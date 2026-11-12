# Framework integrations

Minimal end-to-end checks that a `@tskm/core` schema can be handed to a framework
as-is. Each framework reads `schema["~standard"]` (Standard Schema). Nothing in
these samples wraps the schema in a library-specific adapter.

`@tskm/core` stays free of runtime dependencies. These packages live only in this
private example, which is not part of a published tskm package.

| Framework | Entry | What is passed |
| --- | --- | --- |
| Hono | `@hono/standard-validator` `sValidator` | `sValidator("json", userSchema)` |
| tRPC | `procedure.input` | `input(userSchema)` |
| TanStack Router | `validateSearch` | `validateSearch: userSchema` |
| TanStack Form | `@tanstack/form-core` `FormApi` | `validators.onChange: userSchema` |
| React Hook Form | `@hookform/resolvers` `standardSchemaResolver` | `standardSchemaResolver(userSchema)` |
| Elysia | route `body` | `body: userSchema` |
| oRPC | `os.input` | `input(userSchema)` (validation only; `@orpc/server` 1.16.1) |
| oRPC OpenAPI | `@orpc/openapi` `OpenAPIGenerator` | `input(withJsonSchema(userSchema))` (`@orpc/openapi` 2.0.0-beta.50) |
| hono-openapi | `loadVendor` + `validator` | `loadVendor("tskm", { toJSONSchema })`, then `validator("json", withJsonSchema(userSchema))` |
| h3 | `readValidatedBody` | `readValidatedBody(event, userSchema)` |
| Conform | `configureForms()` + `useForm` (future) | `useForm(profileSchema)` with the defaults |
| Vercel AI SDK (`ai` 7) | `tool({ inputSchema })` | `inputSchema: withJsonSchema(userSchema)` (mock model) |

The AI SDK reads a JSON Schema. It takes
`schema["~standard"].jsonSchema`, which `withJsonSchema` from `@tskm/core/json-schema`
adds, so the sample wraps `userSchema` explicitly. A plain tskm schema has no
`jsonSchema` member, and the SDK rejects it with `does not support JSON Schema
conversion`. The model is a `MockLanguageModelV4` from `ai/test`, so the test sends no
request. [`ai-sdk/tool.e2e.ts`](ai-sdk/tool.e2e.ts) checks the document the model
receives, a valid call, an invalid call (rejected by tskm), a plain schema, and a
schema tskm cannot express.

OpenAPI is generated in two samples. Both calls are explicit, and `@tskm/core` does
not wrap a schema or register a vendor for either library.

`@orpc/openapi` **2.0.0-beta.50** (beta, exact pin) reads Standard JSON Schema when
`new OpenAPIGenerator()` is given no converters. It calls
`jsonSchema.input({ target: "draft-2020-12" })` and writes that document on
`requestBody`. `withJsonSchema(userSchema)` is what supplies `jsonSchema`. A plain tskm
schema has no `jsonSchema` member: the operation is still emitted, and `requestBody` is
absent. [`orpc-openapi/openapi.e2e.ts`](orpc-openapi/openapi.e2e.ts) locks the wrapped
document and that omission. [`orpc/procedure.e2e.ts`](orpc/procedure.e2e.ts) stays on `@orpc/server`
1.16.1 and only checks validation.

hono-openapi 1.5.0 has no built-in `tskm` vendor. `GET /openapi` returns 500, and the
error is `UnsupportedVendorError` (`standard-json: Unsupported schema vendor "tskm"`),
until the caller registers one. [`hono-openapi/openapi.e2e.ts`](hono-openapi/openapi.e2e.ts)
calls `loadVendor("tskm", { toJSONSchema })`, where `toJSONSchema` is
`schema => schema["~standard"].jsonSchema.input({ target: "draft-2020-12" })`. With
that registration the same route returns 200 and the request body and the 200 response
use that document.

Conform's future API already accepts any Standard Schema (`~standard.version === 1`)
and validates with `schema["~standard"].validate`. The sample does not pass
`isSchema` or `validateSchema`. A submission's values are form-control strings, so
the Conform schema is `name` + `email` rather than `userSchema`'s `age: number()`
(`"36"` is not a number). The DOM for that test comes from `happy-dom`.

The shared schema is [`shared/user-schema.ts`](shared/user-schema.ts): `name`
(non-empty string), `email`, and `age` (number). Each `*.e2e.ts` file checks a success
and a failure. Where the framework reports the issues, the failure asserts which fields
they name.

The shared code lives in `shared/`, not `src/`. `scripts/node-smoke.mjs` runs
`tskm gen` on every example that has a `src/` directory, and the generator emits a
`.gen.ts` for each schema module under `src/`. This example is not a generation
project, so it stays out of that path.

Files are named `*.e2e.ts` so the root `bun test` does not pick them up. CI runs
them from [`.github/workflows/integrations.yml`](../../.github/workflows/integrations.yml).

## Run

From the repository root, after `bun install`:

```bash
bun run build
bun run --cwd examples/integrations typecheck
bun run --cwd examples/integrations test
```

`@tskm/core` resolves through the workspace link to the built `dist`, the same
entry a consumer installs, for both the typecheck and the tests. So `bun run build`
must run first. Without it the tests fail with `Cannot find module '@tskm/core'`.

`test` runs every `*/*.e2e.ts` file, so a new framework directory is picked up
without editing `package.json`.
