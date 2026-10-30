import type { TskmConfig } from "../src/config.ts"

/**
 * Compat CI sets this to a tsgo binary other than the pinned
 * `@typescript/native-preview` (today, `typescript@next`'s `lib/tsc`).
 * Unset means every caller keeps the native-preview default.
 */
export const TSKM_TEST_TSGO_EXECUTABLE = "TSKM_TEST_TSGO_EXECUTABLE"

/** The override path, or `undefined` when the env is unset or blank. */
export function testTsgoExecutable(): string | undefined {
  const value = process.env[TSKM_TEST_TSGO_EXECUTABLE]
  if (value === undefined || value.trim() === "") return undefined
  return value
}

/**
 * Returns `config` unchanged when no override is set (same object). Otherwise
 * copies it and sets `executable`, leaving an explicit `executable` alone.
 */
export function withTestTsgo(config: TskmConfig): TskmConfig {
  const executable = testTsgoExecutable()
  if (executable === undefined || config.executable !== undefined) return config
  return { ...config, executable }
}
