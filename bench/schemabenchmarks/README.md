# schemabenchmarks

Library definition for listing tskm on [schemabenchmarks](https://schemabenchmarks.dev).
The files in `libraries/tskm/` follow the `schemas/libraries/<name>/` layout of
[open-circle/schema-benchmarks](https://github.com/open-circle/schema-benchmarks) at
commit [`16c9d3d`](https://github.com/open-circle/schema-benchmarks/commit/16c9d3d).
Copy that directory into a clone pinned at that commit.

Leave the upstream pull request unopened. Upstream
[CONTRIBUTING.md](https://github.com/open-circle/schema-benchmarks/blob/16c9d3d/CONTRIBUTING.md)
asks contributors not to submit a pull request written only by an AI. A person reviews this
definition and decides whether to open one.

## Layout

`libraries/tskm/`

- `index.ts` — product, rating, and image schemas. `InferOutput` of `productSchema` satisfies the shared `ProductData` type.
- `benchmarks.ts` — validation, parsing, Standard Schema, native JSON Schema conversion, email and url strings, and the throw stack.
- `download/index.ts` — entry Rolldown bundles for the download-size bench.
- `download_compiled/index/minified.js` and `unminified.js` — that bundle, committed the same way typia and zod-compiler commit theirs.
- `index.gen.ts` — AOT sidecar (`Image`, `Rating`, `Product`) from `@tskm/compiler` 0.6.0.
- `tskm.config.mjs` and `tsconfig.json` — regenerate the sidecar. The tsconfig extends `../../tsconfig.json`, which is `schemas/tsconfig.json` after the copy.
- `types/index.ts` — `InferInput` and `InferOutput` probe.

## Calls

`optimizeType` is `"none"`. The published runtime interprets the schema. `safeParseCompiled` lowers that schema to a closure tree when it is called. The committed bundles contain neither `eval` nor `new Function`.

| Area | Call |
| --- | --- |
| validation | `is(schema, data)` |
| validation, note `compiled` | `safeParseCompiled(schema, data).success` |
| parsing, all errors | `safeParse(schema, data)` and `safeParseCompiled(schema, data)` |
| parsing, abort early | `safeParse(schema, data, { mode: "reject" })` |
| standard | `productSchema` as a Standard Schema (`allErrors`) |
| JSON Schema | `withJsonSchema(subject)["~standard"].jsonSchema.<direction>({ target })` |
| string | `pipe(string(), email())`, `pipe(string(), url())` |
| stack | `parse(schema, data)` |

`library.version` is `await getVersion("tskm")`.

The JSON Schema subject is `{ id: number, name: string, price: string }` on input and `{ id: number, name: string, price: number }` on output. `price` is `pipe(string(), transform(decimalIntegerStringToNumber))`. The transform accepts a string of decimal digits and returns `Number(value)`. `standardJsonSchema` is `{ type: "native", schema }`, so the matrix field is `"native"`.

Input conversion succeeds for `draft-2020-12`, `draft-07`, and `openapi-3.0`. Each document is:

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "number" },
    "name": { "type": "string" },
    "price": { "type": "string" }
  },
  "required": ["id", "name", "price"],
  "additionalProperties": false
}
```

Output conversion throws, from both `generate` and `~standard.jsonSchema.output`:

> tskm: cannot convert pipe item "transform" to JSON Schema output: the transform's output type is not reified at runtime. input() still describes the schema before the transform

`schemas/test/libraries.node.test.ts` treats a throw as no schema on both paths, so the two results stay equal, and it skips the accepted-schema assertion for that direction. The conversion bench records the message on the support matrix and continues.

`vpr schemas:build` runs `schemas/scripts/gen-accepted-json-schemas.ts`. On the `16c9d3d` clone that accepted the input document above:

- `draft-2020-12` input is a new accepted shape. tskm emits no `$schema`.
- `draft-07` input matches the shape already accepted for joi.
- `openapi-3.0` input matches the shape already accepted for joi and zod v3.

## Dependencies on the clone

Add this to `schemas/package.json`, then run `pnpm install` from the clone root:

```json
{
  "dependencies": {
    "@tskm/core": "0.4.0",
    "tskm": "npm:@tskm/core@0.4.0"
  }
}
```

`getVersion` runs `pnpm --filter schemas list tskm --json` and reads that package's version. The alias makes the reported name `tskm` and the reported version `0.4.0`, which is `@tskm/core` 0.4.0.

`@tskm/compiler` 0.6.0 is a devDependency only when regenerating `index.gen.ts`. The benchmark imports `@tskm/core`.

The clone's toolchain is the one pinned at `16c9d3d`: Node 26 (`.node-version`) and pnpm 12.19.0.

## Copy

```bash
git clone https://github.com/open-circle/schema-benchmarks
cd schema-benchmarks
git checkout 16c9d3d
# add the dependencies above
pnpm install
cp -a /path/to/tskm/bench/schemabenchmarks/libraries/tskm schemas/libraries/tskm
```

## Regenerating the sidecar

`index.gen.ts` is already generated. Regenerate it when `index.ts` changes.

`@tskm/compiler@0.6.0` peers on `typescript >=7.1.0-beta <8`. The clone's catalog pins `typescript@7.0.2`, so generation runs in a side install and the clone's TypeScript stays put.

`libraries/tskm/tsconfig.json` includes `*.ts` and excludes `benchmarks.ts`. The compiler writes a sibling `index.tskm-query.ts` and has to see it in the program. This repository gitignores `*.tskm-query.ts`. `benchmarks.ts` imports modules that exist only in the upstream clone, so it stays out of the compiler program.

```bash
mkdir /tmp/tskm-gen && cd /tmp/tskm-gen
npm init -y
npm install --save-exact @tskm/compiler@0.6.0 @tskm/core@0.4.0 typescript@7.1.0-beta
cd /path/to/schemas/libraries/tskm
/tmp/tskm-gen/node_modules/.bin/tskm gen
```

`download/index.ts` type-imports `Product` from `index.gen.ts`. Rolldown drops that import, so the download bundle is the runtime plus the schema module.

`vpr bench:download`, the first step of `vpr bench:all`, rewrites `download_compiled/`. The files in this repo are the bundles from the verification run below.

## Verification

Clone at `16c9d3d`, definition copied to `schemas/libraries/tskm/`, dependencies added as above. These are pass/fail results and byte sizes from that clone. They are a single run on one machine, and they are not an ops/s ranking.

- `vpr schemas:build` — exit 0. The `@schema-benchmarks/schemas` build completed, then `gen-accepted-json-schemas.ts` updated `schemas/test/accepted-json-schemas.ts` as described above.
- `vp test run test/libraries.node.test.ts` from `schemas/` — 7825 passed, 338 skipped, no type errors, exit 0. The tskm input documents were accepted. The three output directions were skipped because generation throws.
- `vpr bench:all` — exit 0. All five steps succeeded: `bench:download`, `bench:bench`, `bench:json-schema`, `bench:stack`, and `bench:types`.
  - The library bench completed 16 tskm tasks and reported no errored tasks. Version `0.4.0`.
  - The JSON Schema step recorded `source` and `standardJsonSchema` as `native`. Input is supported for `draft-2020-12`, `draft-07`, and `openapi-3.0`. Output for each target is the transform error quoted above.
  - The stack step recorded `parse(schema, data)` as a thrown error that carries stack frames.
  - The types step, on TypeScript 6.0.3, reported `Input` and `Output` both matching `ProductData` exactly, with 2181 instantiations for the combined probe.

Download sizes from `bench/download.json` for `tskm` 0.4.0, entry `tskm/download/index.ts`:

| Bundle | Bytes | Gzip |
| --- | --- | --- |
| minified | 7926 | 2528 |
| unminified | 17045 | 4465 |
