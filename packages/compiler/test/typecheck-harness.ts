import { spawnSync } from "node:child_process"
import { resolveTsgoExecutable } from "../src/tsgo-client.ts"

/**
 * The keystone soundness check the suite previously lacked: run the REAL tsgo
 * binary (`--noEmit`) over a fixture project AFTER generation, so the generated
 * `.gen.ts` files — self-referential aliases, cross-referencing mutual aliases,
 * checker/structural merges — must actually compile, and a probe file can assert
 * value-level assignability against them. A back-edge that doesn't exactly match
 * its declared alias name fails HERE (TS2304), not silently downstream.
 */
export function runTsgoNoEmit(projectRoot: string): { ok: boolean; output: string } {
  const executable = resolveTsgoExecutable()
  const child = spawnSync(executable, ["--noEmit", "-p", "tsconfig.json"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 120_000,
    killSignal: "SIGKILL",
  })
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`
  return { ok: child.status === 0, output }
}
