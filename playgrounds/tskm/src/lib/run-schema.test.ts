import { expect, test } from "bun:test"
import { compileSchema, runSchema } from "./run-schema.ts"

const defaultConfig = { mode: "report", abortPipeEarly: false } as const

test("runSchema returns success with parsed output and no warnings for a valid input", () => {
  const result = runSchema(
    `object({ name: string(), age: number() })`,
    `{ "name": "ada", "age": 36 }`,
    defaultConfig,
  )

  expect(result.status).toBe("success")
  if (result.status !== "success") throw new Error("expected success")
  expect(result.output).toEqual({ name: "ada", age: 36 })
  expect(result.warnings).toEqual([])
  expect(result.flatErrors).toBeUndefined()
})

test("runSchema reports a failure with mapped issues and flattened errors", () => {
  const result = runSchema(
    `object({ name: pipe(string(), minLength(2)), age: pipe(number(), minValue(18)) })`,
    `{ "name": "A", "age": 10 }`,
    defaultConfig,
  )

  expect(result.status).toBe("failure")
  if (result.status !== "failure") throw new Error("expected failure")
  expect(result.issues.length).toBeGreaterThan(0)
  // Nested object issues are keyed by their dot path, not the "root" fallback.
  expect(result.issues.map((issue) => issue.path)).toContain("name")
  expect(result.issues.every((issue) => issue.severity === "error")).toBe(true)
  expect(result.flatErrors.nested).toBeDefined()
})

test("runSchema carries non-fatal transform warnings on a successful parse", () => {
  const result = runSchema(
    `pipe(
      string(),
      transform((value, ctx) => {
        if (value !== value.trim()) {
          ctx.issue("trimmed surrounding whitespace", "warning")
        }
        return value.trim()
      }),
    )`,
    `"  spaced  "`,
    defaultConfig,
  )

  expect(result.status).toBe("success")
  if (result.status !== "success") throw new Error("expected success")
  expect(result.output).toBe("spaced")
  expect(result.warnings).toHaveLength(1)
  expect(result.warnings[0]?.severity).toBe("warning")
  expect(result.warnings[0]?.message).toContain("trimmed")
})

test("runSchema maps a top-level issue to the 'root' path", () => {
  const result = runSchema(`string()`, `42`, defaultConfig)

  expect(result.status).toBe("failure")
  if (result.status !== "failure") throw new Error("expected failure")
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0]?.path).toBe("root")
})

test("runSchema surfaces compile-time failures as a runtime error", () => {
  const result = runSchema(`notARealSchema()`, `null`, defaultConfig)

  expect(result.status).toBe("runtime-error")
  if (result.status !== "runtime-error") throw new Error("expected runtime-error")
  expect(result.message.length).toBeGreaterThan(0)
})

test("runSchema surfaces invalid JSON input as a runtime error", () => {
  const result = runSchema(`string()`, `{ not json }`, defaultConfig)

  expect(result.status).toBe("runtime-error")
  if (result.status !== "runtime-error") throw new Error("expected runtime-error")
  expect(result.message.length).toBeGreaterThan(0)
})

test("runSchema passes abortPipeEarly through to the parser so it bails at the first error", () => {
  const schema = `pipe(string(), minLength(5), email())`

  const reportAll = runSchema(schema, `"a"`, { mode: "report", abortPipeEarly: false })
  const bailEarly = runSchema(schema, `"a"`, { mode: "report", abortPipeEarly: true })

  expect(reportAll.status).toBe("failure")
  expect(bailEarly.status).toBe("failure")
  if (reportAll.status !== "failure" || bailEarly.status !== "failure") {
    throw new Error("expected failures")
  }
  // Bailing at the first pipe issue yields strictly fewer issues than collecting them all.
  expect(bailEarly.issues.length).toBeLessThan(reportAll.issues.length)
})

test("compileSchema evaluates source against the tskm bindings", () => {
  const schema = compileSchema(`object({ id: number() })`) as { type: string }
  expect(schema.type).toBe("object")
})
