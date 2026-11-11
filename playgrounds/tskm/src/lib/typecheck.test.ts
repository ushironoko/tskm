import { expect, mock, test } from "bun:test"
import {
  createTypecheckInputText,
  fetchInputTypecheck,
  toEditorDiagnostic,
  typecheckInputInBrowser,
} from "./typecheck.ts"

const monacoSpecifier = "monaco-editor/esm/vs/editor/editor.main.js"

interface MockDiagnostic {
  readonly start?: number
  readonly length?: number
  readonly messageText: string | { messageText: string; next?: readonly unknown[] }
  readonly category: number
  readonly code: number
}

// A minimal stand-in for the slice of the Monaco editor API that the browser typechecker
// drives: a model registry, the TypeScript defaults, and a worker that returns canned
// diagnostics. It lets us exercise the full browser orchestration path headlessly.
function makeMonacoMock(options: {
  readonly semantic?: readonly MockDiagnostic[]
  readonly syntactic?: readonly MockDiagnostic[]
  readonly worker?: () => Promise<(uri: unknown) => Promise<unknown>>
}) {
  const models = new Map<string, { getValue: () => string; setValue: (v: string) => void }>()
  const defaultWorker = async () => async (_uri: unknown) => ({
    getSyntacticDiagnostics: async () => options.syntactic ?? [],
    getSemanticDiagnostics: async () => options.semantic ?? [],
  })
  const monaco = {
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    editor: {
      getModel: (uri: { toString: () => string }) => models.get(uri.toString()),
      createModel: (text: string, _lang: string, uri: { toString: () => string }) => {
        let value = text
        const model = { getValue: () => value, setValue: (v: string) => (value = v) }
        models.set(uri.toString(), model)
        return model
      },
    },
    typescript: {
      ScriptTarget: { ESNext: 99 },
      ModuleKind: { ESNext: 99 },
      ModuleResolutionKind: { NodeJs: 2 },
      typescriptDefaults: {
        setCompilerOptions: (_options: unknown) => {},
        setEagerModelSync: (_value: boolean) => {},
      },
      getTypeScriptWorker: options.worker ?? defaultWorker,
    },
  }
  return { monaco, models }
}

const inputPrefix = `import type { PlaygroundOutput } from "./playground.schema.gen"\n\nconst playgroundInput: PlaygroundOutput = `

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

test("remaps a type-mismatch anchored on the property key to its value position", () => {
  const inputSource = `{\n  "count": "1"\n}`
  const inputText = createTypecheckInputText(inputSource)
  // Monaco reports the error starting at the property key; the mapper walks past the key
  // and its colon so the highlight lands on the offending value ("1"), not the key.
  const diagnostic = toEditorDiagnostic(
    {
      start: inputText.indexOf('"count"'),
      length: '"count"'.length,
      messageText: "Type 'string' is not assignable to type 'number'.",
      category: 1,
      code: 2322,
    },
    inputSource,
  )

  expect(diagnostic.startOffset).toBe(inputSource.indexOf('"1"'))
  expect(diagnostic.endOffset).toBe(inputSource.indexOf('"1"') + '"1"'.length)
  // The value sits on the second line, so the mapped position reflects that.
  expect(diagnostic.line).toBe(1)
})

test("keeps the key anchor when a type-mismatch key is not followed by a value", () => {
  // The quoted token is not a property key (no following colon), so the remapping leaves
  // the anchor where Monaco put it.
  const inputSource = `["draft"]`
  const inputText = createTypecheckInputText(inputSource)
  const diagnostic = toEditorDiagnostic(
    {
      start: inputText.indexOf('"draft"'),
      length: '"draft"'.length,
      messageText: 'Type \'"draft"\' is not assignable to type \'"a" | "b"\'.',
      category: 1,
      code: 2322,
    },
    inputSource,
  )

  expect(diagnostic.startOffset).toBe(inputSource.indexOf('"draft"'))
  expect(diagnostic.endOffset).toBe(inputSource.indexOf('"draft"') + '"draft"'.length)
})

test("leaves the anchor untouched for a message that is not a type mismatch", () => {
  const inputSource = `{ "x": 1 }`
  const inputText = createTypecheckInputText(inputSource)
  const diagnostic = toEditorDiagnostic(
    {
      start: inputText.indexOf('"x"'),
      length: 3,
      messageText: "Object literal may only specify known properties.",
      category: 1,
      code: 2353,
    },
    inputSource,
  )

  // No key→value remap for a non-assignability message; the anchor stays on the key token.
  expect(diagnostic.startOffset).toBe(inputSource.indexOf('"x"'))
  expect(diagnostic.endOffset).toBe(inputSource.indexOf('"x"') + 3)
})

test("flattens a nested diagnostic message chain into newline-joined text", () => {
  const diagnostic = toEditorDiagnostic(
    {
      start: inputPrefix.length,
      length: 1,
      messageText: {
        messageText: "Type A is not assignable to type B.",
        next: [
          { messageText: "Types of property 'id' are incompatible." },
          { messageText: "Nested reason.", next: [{ messageText: "Deepest reason." }] },
        ],
      },
      category: 1,
      code: 2322,
    },
    "1",
  )

  expect(diagnostic.message).toBe(
    [
      "Type A is not assignable to type B.",
      "Types of property 'id' are incompatible.",
      "Nested reason.",
      "Deepest reason.",
    ].join("\n"),
  )
})

test("prefers an explicit pre-flattened message over the message chain", () => {
  const diagnostic = toEditorDiagnostic(
    {
      start: inputPrefix.length,
      length: 1,
      message: "Already flattened message.",
      messageText: { messageText: "Ignored chain root." },
      category: 1,
      code: 2322,
    },
    "42",
  )

  expect(diagnostic.message).toBe("Already flattened message.")
})

test("maps diagnostic categories to warning, error, and info labels", () => {
  const make = (category: number) =>
    toEditorDiagnostic(
      { start: inputPrefix.length, length: 1, messageText: "m", category, code: 1 },
      "1",
    ).category

  expect(make(0)).toBe("warning")
  expect(make(1)).toBe("error")
  expect(make(2)).toBe("info")
})

test("falls back to the first non-whitespace offset when the diagnostic has no start", () => {
  const inputSource = `   true`
  const diagnostic = toEditorDiagnostic(
    { length: 0, messageText: "Some diagnostic.", category: 1, code: 1 },
    inputSource,
  )

  // With no `start`, the anchor is the first non-whitespace character, and the end expands
  // across the whole `true` token.
  expect(diagnostic.startOffset).toBe(inputSource.indexOf("true"))
  expect(diagnostic.endOffset).toBe(inputSource.length)
})

test("expands the highlight to a full numeric token", () => {
  const inputSource = `-12.5e3`
  const diagnostic = toEditorDiagnostic(
    { start: inputPrefix.length, length: 1, messageText: "n", category: 1, code: 1 },
    inputSource,
  )

  expect(diagnostic.startOffset).toBe(0)
  expect(diagnostic.endOffset).toBe(inputSource.length)
})

test("uses the line fallback when the anchor lands past every token", () => {
  // The anchor points into the trailing whitespace after the last token, so no token
  // encloses or follows it and the end falls back to the end of the line.
  const inputSource = `42   `
  const anchor = 3
  const diagnostic = toEditorDiagnostic(
    { start: inputPrefix.length + anchor, length: 0, messageText: "x", category: 1, code: 1 },
    inputSource,
  )

  expect(diagnostic.startOffset).toBe(anchor)
  expect(diagnostic.endOffset).toBe(inputSource.length)
})

test("clamps an out-of-range diagnostic start back to the fallback offset", () => {
  const inputSource = `  "hello"`
  // A start far beyond the generated input text is out of range and is discarded in favour
  // of the first non-whitespace offset.
  const diagnostic = toEditorDiagnostic(
    { start: 10_000, length: 1, messageText: "oops", category: 1, code: 1 },
    inputSource,
  )

  expect(diagnostic.startOffset).toBe(inputSource.indexOf('"hello"'))
})

test("reports an error state in the browser path when the schema cannot compile", async () => {
  // An invalid schema source makes the fallback type generation fail, so the browser
  // typecheck short-circuits to an error without ever loading the TypeScript worker.
  const state = await typecheckInputInBrowser("not a schema ((", '"x"')

  expect(state.status).toBe("error")
  expect(state.diagnostics).toEqual([])
  expect(state.message?.length ?? 0).toBeGreaterThan(0)
})

test("fetchInputTypecheck delegates to the in-browser path without an endpoint", async () => {
  // Without the playground API endpoint enabled, fetchInputTypecheck runs the in-browser
  // typechecker; an uncompilable schema surfaces as an error state here too.
  const controller = new AbortController()
  const state = await fetchInputTypecheck("still (( broken", '"x"', controller.signal)

  expect(state.status).toBe("error")
  expect(state.diagnostics).toEqual([])
})

test("browser typecheck compiles, type-checks, and maps worker diagnostics", async () => {
  const inputSource = `{\n  "count": "1"\n}`
  const inputText = createTypecheckInputText(inputSource)
  const { monaco, models } = makeMonacoMock({
    semantic: [
      {
        start: inputText.indexOf('"1"'),
        length: 3,
        messageText: "Type 'string' is not assignable to type 'number'.",
        category: 1,
        code: 2322,
      },
    ],
  })
  mock.module(monacoSpecifier, () => monaco)

  const state = await typecheckInputInBrowser(`object({ count: number() })`, inputSource)
  expect(state.status).toBe("ready")
  expect(state.diagnostics).toHaveLength(1)
  expect(state.diagnostics[0]?.category).toBe("error")
  expect(state.diagnostics[0]?.code).toBe(2322)
  expect(state.diagnostics[0]?.startOffset).toBe(inputSource.indexOf('"1"'))

  // Two models are registered (the input and the generated type).
  expect(models.size).toBe(2)

  // A second run reuses the existing models, updating their contents in place rather than
  // recreating them.
  const nextInput = `{\n  "count": "2"\n}`
  const second = await typecheckInputInBrowser(`object({ count: number() })`, nextInput)
  expect(second.status).toBe("ready")
  expect(models.size).toBe(2)
})

test("browser typecheck reports an error when the TypeScript worker never registers", async () => {
  const previousWindow = (globalThis as { window?: unknown }).window
  // waitForTypeScriptReady backs off via window.setTimeout; run it synchronously here.
  ;(globalThis as { window?: unknown }).window = {
    setTimeout: (handler: () => void) => {
      handler()
      return 0
    },
  }
  try {
    const { monaco } = makeMonacoMock({
      worker: async () => async () => {
        throw new Error("TypeScript not registered yet")
      },
    })
    mock.module(monacoSpecifier, () => monaco)

    const state = await typecheckInputInBrowser(`string()`, '"x"')
    expect(state.status).toBe("error")
    expect(state.message).toContain("worker")
    expect(state.diagnostics).toEqual([])
  } finally {
    ;(globalThis as { window?: unknown }).window = previousWindow
  }
})

test("browser typecheck rethrows an unexpected worker error", async () => {
  const { monaco } = makeMonacoMock({
    worker: async () => async () => {
      throw new Error("some unexpected worker failure")
    },
  })
  mock.module(monacoSpecifier, () => monaco)

  // An error unrelated to worker registration is not a readiness retry, so it propagates.
  await expect(typecheckInputInBrowser(`string()`, '"x"')).rejects.toThrow(
    "some unexpected worker failure",
  )
})
