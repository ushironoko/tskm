import type { TskmConfig } from "../src/config.ts"

/**
 * Compat CI used to point this at a checker binary other than the one
 * bundled with the imported `typescript` package. The sync client and the
 * binary are one package now, so an unset value keeps that package's `lib/tsc`.
 * An explicit path still overrides both the client and the `--noEmit` probe.
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
