import { describe, expect, it } from "vitest"
import { number, objectAsync, safeParseAsync, string, unionAsync } from "../src/index.ts"

describe("unionAsync", () => {
  it("resolves to the first matching option", async () => {
    const result = await safeParseAsync(unionAsync([string(), number()]), 1)
    expect(result.success).toBe(true)
    expect(result.output).toBe(1)
  })

  it("accepts an async member schema", async () => {
    const schema = unionAsync([string(), objectAsync({ id: number() })])
    const result = await safeParseAsync(schema, { id: 7 })
    expect(result.success).toBe(true)
    expect(result.output).toEqual({ id: 7 })
  })

  it("emits exactly one schema issue when no option matches", async () => {
    const result = await safeParseAsync(unionAsync([string(), number()]), true)
    expect(result.success).toBe(false)
    // Narrow the discriminated result so `issues` is the non-undefined branch.
    if (!result.success) {
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0]?.type).toBe("union")
    }
  })

  it("~standard.validate returns a Promise resolving to the right result", async () => {
    const schema = unionAsync([string(), number()])
    const pending = schema["~standard"].validate(1)
    expect(pending).toBeInstanceOf(Promise)
    const result = await pending
    expect("issues" in result && result.issues !== undefined).toBe(false)
    expect("value" in result && result.value).toBe(1)
  })
})
