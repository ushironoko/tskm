import { expect, test } from "bun:test"
import { createTypecheckInputText, toEditorDiagnostic } from "./typecheck.ts"

test("maps Monaco TypeScript diagnostics back to playground input", () => {
  const inputSource = `{
  "role": "guest",
  "count": "1"
}`
  const inputText = createTypecheckInputText(inputSource)

  const diagnostic = toEditorDiagnostic(
    {
      start: inputText.indexOf('"guest"'),
      length: '"guest"'.length,
      messageText: 'Type \'"guest"\' is not assignable to type \'"owner" | "viewer"\'.',
      category: 1,
      code: 2322,
    },
    inputSource,
  )

  expect(inputText).toContain(inputSource)
  expect(diagnostic.category).toBe("error")
  expect(diagnostic.code).toBe(2322)
  expect(diagnostic.message).toContain('"guest"')
  expect(diagnostic.startOffset).toBe(inputSource.indexOf('"guest"'))
  expect(diagnostic.endOffset).toBe(inputSource.indexOf('"guest"') + '"guest"'.length)
})
