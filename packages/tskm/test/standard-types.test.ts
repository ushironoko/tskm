import { describe, expect, it } from "bun:test"
import { object, objectAsync, string, union } from "../src/index.ts"

/**
 * Runtime guard for issue #20 AC3: populating `~standard.types` is type-level only. The
 * runtime props object must stay exactly version/vendor/validate, with no `types` field
 * added (the present `types` is a phantom carrier asserted in the type, never built).
 */
describe("~standard runtime shape is unchanged (#20)", () => {
  const cases = {
    string: string(),
    object: object({ a: string() }),
    union: union([string()]),
    objectAsync: objectAsync({ a: string() }),
  }

  for (const [name, schema] of Object.entries(cases)) {
    it(`${name} exposes only version/vendor/validate at runtime`, () => {
      const std = schema["~standard"]
      expect(Object.keys(std).sort()).toEqual(["validate", "vendor", "version"])
      expect("types" in std).toBe(false)
    })
  }
})
