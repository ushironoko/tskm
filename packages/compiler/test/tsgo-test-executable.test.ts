import { afterEach, describe, expect, it } from "bun:test"
import {
  TSKM_TEST_TSGO_EXECUTABLE,
  testTsgoExecutable,
  withTestTsgo,
} from "./tsgo-test-executable.ts"

const saved = process.env[TSKM_TEST_TSGO_EXECUTABLE]

afterEach(() => {
  if (saved === undefined) delete process.env[TSKM_TEST_TSGO_EXECUTABLE]
  else process.env[TSKM_TEST_TSGO_EXECUTABLE] = saved
})

describe("TSKM_TEST_TSGO_EXECUTABLE", () => {
  it("leaves config untouched when the env is unset", () => {
    delete process.env[TSKM_TEST_TSGO_EXECUTABLE]
    expect(testTsgoExecutable()).toBeUndefined()
    const config = { mode: "sidecar" as const, include: ["src/**/*.ts"] }
    expect(withTestTsgo(config)).toBe(config)
  })

  it("treats a blank value as unset", () => {
    process.env[TSKM_TEST_TSGO_EXECUTABLE] = "   "
    expect(testTsgoExecutable()).toBeUndefined()
    const config = { include: ["a.ts"] }
    expect(withTestTsgo(config)).toBe(config)
  })

  it("sets executable from the env and keeps an explicit one", () => {
    process.env[TSKM_TEST_TSGO_EXECUTABLE] = "/opt/tsgo"
    expect(testTsgoExecutable()).toBe("/opt/tsgo")
    expect(withTestTsgo({ include: ["a.ts"] })).toEqual({
      include: ["a.ts"],
      executable: "/opt/tsgo",
    })
    expect(withTestTsgo({ executable: "/other" })).toEqual({ executable: "/other" })
  })
})
