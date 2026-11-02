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
| oRPC | `os.input` | `input(userSchema)` (validation only; no OpenAPI) |
| h3 | `readValidatedBody` | `readValidatedBody(event, userSchema)` |
| Conform | `configureForms()` + `useForm` (future) | `useForm(profileSchema)` with the defaults |

Conform's future API already accepts any Standard Schema (`~standard.version === 1`)
and validates with `schema["~standard"].validate`. The sample does not pass
`isSchema` or `validateSchema`. A submission's values are form-control strings, so
the Conform schema is `name` + `email` rather than `userSchema`'s `age: number()`
(`"36"` is not a number). The DOM for that test comes from `happy-dom`.

The shared schema is [`src/user-schema.ts`](src/user-schema.ts): `name` (non-empty
string), `email`, and `age` (number). Each `*.e2e.ts` file checks one success and
one failure.

Files are named `*.e2e.ts` so the root `bun test` does not pick them up. CI runs
them from [`.github/workflows/integrations.yml`](../../.github/workflows/integrations.yml).

## Run

From the repository root, after `bun install`:

```bash
bun run build
bun run --cwd examples/integrations typecheck
bun run --cwd examples/integrations test
```

`bun run build` is required for the tests: they import the workspace package,
whose `exports` point at `dist`. Typecheck resolves `@tskm/core` to the package
source via this example's `tsconfig` `paths`.
