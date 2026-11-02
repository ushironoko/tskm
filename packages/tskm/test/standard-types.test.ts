import { describe, expect, it } from "bun:test"
import { object, objectAsync, string, union } from "../src/index.ts"

/**
 * Runtime guard for issue #20 AC3: populating `~standard.types` is type-level only.
 * `jsonSchema` is a real Standard JSON Schema field (issue #57). `types` stays absent.
 */
describe("~standard runtime shape (#20, #57)", () => {
  const cases = {
    string: string(),
    object: object({ a: string() }),
    union: union([string()]),
    objectAsync: objectAsync({ a: string() }),
  }

  for (const [name, schema] of Object.entries(cases)) {
    it(`${name} exposes version/vendor/validate/jsonSchema and not types`, () => {
      const std = schema["~standard"]
      expect(Object.keys(std).sort()).toEqual(["jsonSchema", "validate", "vendor", "version"])
      expect("types" in std).toBe(false)
    })
  }
})
