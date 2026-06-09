/**
 * One-command harness orchestrator. Runs both benchmark suites, captures a CPU profile for
 * each, and writes a markdown report under bench/results.
 *
 *   bun bench/run.ts                 compare both suites against committed baselines, profile
 *   bun bench/run.ts --write-baseline  also overwrite the committed baselines with this run
 *   bun bench/run.ts --no-profile      skip the CPU-profile capture (faster)
 *
 * Baselines live in bench/baselines/*.json (committed); profiles and the report land in
 * bench/results (gitignored). The bench subprocesses do the measuring so each suite is timed
 * in a clean process; this file only coordinates and profiles.
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { profileScript } from "./lib/profile.ts"

const here = dirname(fileURLToPath(import.meta.url))
const baselinesDir = join(here, "baselines")
const resultsDir = join(here, "results")
const profilesDir = join(resultsDir, "profiles")

const write = process.argv.includes("--write-baseline")
const doProfile = !process.argv.includes("--no-profile")

interface Suite {
  readonly key: string
  readonly script: string
  readonly profileTarget: string
  readonly profileArgs: ReadonlyArray<string>
}

const suites: ReadonlyArray<Suite> = [
  {
    key: "validator",
    script: join(here, "validator", "bench.ts"),
    profileTarget: join(here, "validator", "profile-target.ts"),
    profileArgs: ["", "4000000"],
  },
  {
    key: "compiler",
    script: join(here, "compiler", "bench.ts"),
    profileTarget: join(here, "compiler", "profile-target.ts"),
    profileArgs: ["24"],
  },
]

function runBench(suite: Suite): string {
  const baseline = join(baselinesDir, `${suite.key}.json`)
  const args = [suite.script, "--baseline", baseline]
  if (write) {
    args.push("--write", baseline)
  }
  const out = spawnSync("bun", args, { encoding: "utf8", cwd: join(here, "..") })
  if (out.status !== 0) {
    console.error(out.stdout)
    console.error(out.stderr)
    throw new Error(`${suite.key} bench failed`)
  }
  return out.stdout
}

function captureProfile(suite: Suite): string {
  const artifacts = profileScript({
    script: suite.profileTarget,
    outDir: profilesDir,
    name: suite.key,
    args: suite.profileArgs,
  })
  if (artifacts.cpuprofile) {
    return `- ${suite.key}: \`${artifacts.cpuprofile}\`${artifacts.markdown ? ` (md: \`${artifacts.markdown}\`)` : ""}`
  }
  return `- ${suite.key}: profile capture failed (exit ${artifacts.exitCode})\n\n\`\`\`\n${artifacts.stderr.slice(-800)}\n\`\`\``
}

function main(): void {
  mkdirSync(resultsDir, { recursive: true })
  const sections: string[] = ["# tskm benchmark report\n"]

  for (const suite of suites) {
    console.log(`\n=== ${suite.key} ===`)
    const table = runBench(suite)
    console.log(table)
    sections.push(`## ${suite.key}\n\n${table.trim()}\n`)
  }

  if (doProfile) {
    console.log("\n=== profiles ===")
    const lines = suites.map((s) => {
      console.log(`profiling ${s.key}...`)
      return captureProfile(s)
    })
    sections.push(`## CPU profiles\n\n${lines.join("\n")}\n`)
  }

  const reportPath = join(resultsDir, "report.md")
  writeFileSync(reportPath, `${sections.join("\n")}\n`)
  console.log(`\nreport -> ${reportPath}`)
}

main()
