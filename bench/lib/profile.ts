/**
 * CPU-profile capture built on Bun's native `--cpu-prof`. Each profile target is its own
 * tiny entry script that runs one hot workload in a loop; we spawn it under the profiler
 * so the produced `.cpuprofile` (the standard V8 sampling format, loadable in speedscope,
 * Chrome DevTools, or convertible to pprof) reflects that workload alone. The optional
 * markdown pass (`--cpu-prof-md`) emits a grep- and LLM-friendly call summary next to it.
 *
 * Running the workload in a child process (rather than the V8 inspector API in-process)
 * keeps the harness itself out of the samples and works identically under `bun bench/run.ts`
 * and a one-off manual invocation.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export interface ProfileOptions {
  /** Absolute path to the target entry script (it runs the hot loop and exits). */
  readonly script: string
  /** Directory the `.cpuprofile` (and markdown) are written to; created if absent. */
  readonly outDir: string
  /** Base name for the artifacts, without extension. */
  readonly name: string
  /** Sampling interval in microseconds (default 200 for fine-grained hot loops). */
  readonly intervalUs?: number
  /** Also emit the markdown call summary (default true). */
  readonly markdown?: boolean
  /** Extra environment for the child (e.g. workload selectors). */
  readonly env?: Record<string, string>
  /** Arguments passed to the target script. */
  readonly args?: ReadonlyArray<string>
}

export interface ProfileArtifacts {
  /** Path to the captured `.cpuprofile`, or null if none was produced. */
  readonly cpuprofile: string | null
  /** Path to the markdown summary, or null. */
  readonly markdown: string | null
  readonly exitCode: number
  readonly stderr: string
}

/**
 * Spawns `bun --cpu-prof <script>` and returns the artifact paths. Because we pass an
 * explicit `--cpu-prof-name`, Bun writes a deterministic `<name>.cpuprofile` (and `<name>.md`
 * with `--cpu-prof-md`), overwriting any prior run. We look the produced files up by that
 * exact name rather than by a before/after directory diff, so a re-run that overwrites an
 * existing profile is still detected as success.
 */
export function profileScript(options: ProfileOptions): ProfileArtifacts {
  const { script, outDir, name } = options
  const intervalUs = options.intervalUs ?? 200
  const markdown = options.markdown ?? true
  mkdirSync(outDir, { recursive: true })

  // Bun appends `.cpuprofile` (and `.md`) to the name, so pass the bare base name.
  const flags = [
    "--cpu-prof",
    `--cpu-prof-dir=${outDir}`,
    `--cpu-prof-name=${name}`,
    `--cpu-prof-interval=${intervalUs}`,
  ]
  if (markdown) {
    flags.push("--cpu-prof-md")
  }

  const result = spawnSync("bun", [...flags, script, ...(options.args ?? [])], {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  const cpuprofilePath = join(outDir, `${name}.cpuprofile`)
  const mdPath = join(outDir, `${name}.md`)

  return {
    cpuprofile: existsSync(cpuprofilePath) ? cpuprofilePath : null,
    markdown: markdown && existsSync(mdPath) ? mdPath : null,
    exitCode: result.status ?? -1,
    stderr: result.stderr ?? "",
  }
}
