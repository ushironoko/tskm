import { resolveTsgoExecutable } from "../src/tsgo-client.ts"
import { spawnNoEmit } from "./scenarios/support.ts"
import { testTsgoExecutable } from "./tsgo-test-executable.ts"

/**
 * The keystone soundness check the suite previously lacked: run the REAL tsgo
 * binary (`--noEmit`) over a fixture project AFTER generation, so the generated
 * `.gen.ts` files — self-referential aliases, cross-referencing mutual aliases,
 * checker/structural merges — must actually compile, and a probe file can assert
 * value-level assignability against them. A back-edge that doesn't exactly match
 * its declared alias name fails HERE (TS2304), not silently downstream.
 */
export function runTsgoNoEmit(projectRoot: string): { ok: boolean; output: string } {
  // Unset env: resolveTsgoExecutable(undefined) uses the typescript package's lib/tsc.
  return spawnNoEmit(resolveTsgoExecutable(testTsgoExecutable()), projectRoot)
}
