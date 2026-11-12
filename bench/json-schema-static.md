# Static JSON Schema bundle

esbuild minify + gzip. The static entry imports `withStaticJsonSchema` and a small
schema. The runtime entry imports `withJsonSchema` and the same schema. Gzip sizes
are the compressed bundle, marker check included.

| entry | minify bytes | gzip bytes | contains `convert.ts` |
| --- | ---: | ---: | --- |
| source static | 4998 | 2012 | no |
| source runtime | 14241 | 4724 | yes |
| dist static | 5047 | 2046 | no |
| dist runtime | 14249 | 4762 | yes |

Source gzip delta (runtime − static): 2712 bytes.

The static bundle must not contain `src/json-schema/convert.ts`. The check looks for
`not reified at runtime`, `propertyNames is not part of OpenAPI`, and
`cannot represent a default value in JSON Schema`, which that file emits and the
static helper does not.

Regenerate with `bun bench/json-schema-static-size.ts`.
