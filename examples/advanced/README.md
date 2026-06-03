# @tskm/example-advanced

Three patterns past the [basic loop](../basic): **discriminated unions, recursive (cyclic)
schemas, and the explicit `Infer` marker.** Each schema is materialized into a concrete
`.gen.ts` type by `tskm gen`, so consuming it ([`src/main.ts`](src/main.ts)) costs the type
system nothing.

## 1. Discriminated union

[`src/union.schema.ts`](src/union.schema.ts) — every member carries a `kind` literal:

```ts
export const shapeSchema = union([
  object({ kind: literal("circle"), radius: number() }),
  object({ kind: literal("rectangle"), width: number(), height: number() }),
  object({ kind: literal("text"), content: string() }),
])
```

generates the full union as a concrete type ([`union.schema.gen.ts`](src/union.schema.gen.ts)),
which narrows on `kind` like any hand-written union:

```ts
export type Shape = {
  kind: "circle";
  radius: number;
} | {
  kind: "rectangle";
  width: number;
  height: number;
} | {
  kind: "text";
  content: string;
}
```

## 2. Recursive / cyclic schema — the special notation

[`src/json.schema.ts`](src/json.schema.ts) models a JSON value, which is both a **union** and
**recursive** (a JSON value contains JSON values). TypeScript cannot *infer* a self-referential
type, so a recursive schema needs three things that a normal schema does not:

1. **Hand-write the recursive type** — `Json` mentions `Json`.
2. **Annotate the const** with `GenericSchema<Json>` — this breaks the inference cycle.
3. **Wrap each self-reference in `lazy(() => …)`** — so the schema object can be built before
   it finishes referring to itself (the getter runs on first parse).

```ts
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export const jsonSchema: GenericSchema<Json> = union([
  string(),
  number(),
  boolean(),
  null_(),
  array(lazy(() => jsonSchema)),
  record(lazy(() => jsonSchema)),
])
```

`tskm gen` materializes a correct **self-referential** type ([`json.schema.gen.ts`](src/json.schema.gen.ts)):

```ts
export type Json = string | number | boolean | Json[] | {
  [x: string]: Json;
} | null
```

> **The annotation is required, not optional.** Without `GenericSchema<Json>` the recursive
> position silently degrades to `any` — tskm's fail-closed guard only inspects the top-level
> type, not nested `any`, so codegen would emit a wrong type with no diagnostic. (At runtime
> `lazy` follows the input's depth and is not cycle-guarded, so a pathologically deep value can
> overflow the stack.)

## 3. The explicit `Infer` marker — opt-in discovery

tskm's auto-discovery is syntactic: it only finds a **direct** `export const x = object(…)`
(or another tskm factory). A schema built by a **helper** is invisible to it. In
[`src/book.schema.ts`](src/book.schema.ts) the const's initializer is a call to `makeEntity`,
not a tskm factory:

```ts
function makeEntity<E extends ObjectEntries>(entries: E) {
  return object({ id: string(), ...entries })
}

export const bookSchema = makeEntity({ title: string(), pages: number() })

// Opt in explicitly — this marker is what `tskm gen` keys on.
export type Book = Infer<typeof bookSchema>
```

`export type T = Infer<typeof schema>` (or `InferOutput<…>`) tells the compiler to materialize
that schema anyway. It writes the concrete `Book` into [`book.schema.gen.ts`](src/book.schema.gen.ts);
import `Book` from there. (`tskm gen --mode inplace` rewrites the marker *in place* instead of
writing a sidecar — see the root README.)

## Generate

From the repository root (after `bun install` + `bun run build`):

```bash
node packages/compiler/dist/cli.mjs gen --root examples/advanced
# in a published project this is simply:  npx tskm gen   (or  bunx tskm gen)
```

`tsconfig.json` maps `@tskm/core` to the workspace source via `paths` so the checker can resolve
the inferred output type. In a real project `@tskm/core` is a normal dependency and no `paths`
entry is needed.
