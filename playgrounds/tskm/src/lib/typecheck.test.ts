import { expect, test } from "bun:test"
import { typecheckInputInBrowser } from "./typecheck.ts"

test("typechecks playground input with the browser fallback compiler", async () => {
  const inputSource = `{
  "role": "guest",
  "count": "1"
}`
  const result = await typecheckInputInBrowser(
    `object({
  role: picklist(["owner", "viewer"]),
  count: number(),
})`,
    inputSource,
  )

  expect(result.status).toBe("ready")
  expect(result.diagnostics).toHaveLength(2)
  expect(result.diagnostics[0]?.message).toContain('"guest"')
  expect(result.diagnostics[0]?.startOffset).toBe(inputSource.indexOf('"guest"'))
  expect(result.diagnostics[1]?.message).toContain("string")
  expect(result.diagnostics[1]?.startOffset).toBe(inputSource.indexOf('"1"'))
})
