// In-repo Stryker test runner for `bun test`, replacing the unmaintained
// community plugin. One fresh bun process per run, mutants activated through
// the env var the instrumented header already reads, per-test coverage via
// preload.mjs sequence counters paired with bun's JUnit report (document
// order = execution order). No eager-import and no inspector websocket — the
// two mechanisms that made the community runner misattribute coverage here.
import { execFile } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { commonTokens, declareFactoryPlugin, PluginKind, tokens } from "@stryker-mutator/api/plugin"
import {
  DryRunStatus,
  determineHitLimitReached,
  MutantRunStatus,
  TestStatus,
} from "@stryker-mutator/api/test-runner"
import { parseJunit } from "./junit.mjs"

const PRELOAD_PATH = join(dirname(fileURLToPath(import.meta.url)), "preload.mjs")
const HIT_LIMIT_MESSAGE = "Stryker: Hit count limit reached"

function createBunTestRunner(logger, options) {
  const bunOptions = options.bun ?? {}
  const bunPath = bunOptions.bunPath ?? "bun"
  const workDir = mkdtempSync(join(tmpdir(), "tskm-stryker-bun-"))
  let runCount = 0

  function spawnBun(args, env, timeoutMs) {
    return new Promise((resolve) => {
      execFile(
        bunPath,
        args,
        {
          cwd: process.cwd(),
          env,
          // Stryker computes fractional timeouts (netTime * factor); execFile
          // rejects non-integers with ERR_OUT_OF_RANGE.
          timeout: Math.ceil(timeoutMs),
          killSignal: "SIGKILL",
          maxBuffer: 64 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          resolve({
            exitCode: error ? (error.code ?? 1) : 0,
            timedOut: Boolean(error?.killed),
            stdout: String(stdout),
            stderr: String(stderr),
          })
        },
      )
    })
  }

  async function runBun({ files, activeMutantId, hitLimit, timeoutMs, bail }) {
    runCount++
    const junitFile = join(workDir, `junit-${runCount}.xml`)
    const outFile = join(workDir, `out-${runCount}.json`)
    // afterAll (which writes outFile) does not fire under --bail and the
    // process may be SIGKILLed, so stale files from a previous run must never
    // be readable.
    rmSync(junitFile, { force: true })
    rmSync(outFile, { force: true })

    const args = [
      "test",
      "--reporter=junit",
      `--reporter-outfile=${junitFile}`,
      "--preload",
      PRELOAD_PATH,
    ]
    if (bunOptions.timeout) {
      args.push("--timeout", String(bunOptions.timeout))
    }
    if (bail) {
      args.push("--bail")
    }
    if (files && files.length > 0) {
      args.push(...files)
    }

    const env = { ...process.env, __STRYKER_OUT_FILE__: outFile }
    delete env.__STRYKER_ACTIVE_MUTANT__
    if (activeMutantId !== undefined) {
      env.__STRYKER_ACTIVE_MUTANT__ = String(activeMutantId)
    }
    if (hitLimit !== undefined) {
      env.__STRYKER_HIT_LIMIT__ = String(hitLimit)
    }

    const proc = await spawnBun(args, env, timeoutMs)

    let tests = null
    try {
      tests = parseJunit(readFileSync(junitFile, "utf8"))
    } catch {
      // crash before the reporter flushed; classified by the callers
    }
    let out = null
    try {
      out = JSON.parse(readFileSync(outFile, "utf8"))
    } catch {
      // best-effort by design (--bail / SIGKILL)
    }
    return { ...proc, tests, out }
  }

  return {
    capabilities() {
      return { reloadEnvironment: true }
    },

    async init() {
      const probe = await spawnBun(["--version"], process.env, 10_000)
      if (probe.exitCode !== 0) {
        throw new Error(`bun is not runnable at "${bunPath}": ${probe.stderr || probe.stdout}`)
      }
      logger.debug("using bun %s", probe.stdout.trim())
    },

    async dryRun({ coverageAnalysis, timeout }) {
      const run = await runBun({ timeoutMs: timeout, bail: false })
      if (run.timedOut) {
        return { status: DryRunStatus.Timeout, reason: "Dry run timed out" }
      }
      if (!run.tests) {
        return {
          status: DryRunStatus.Error,
          errorMessage: `bun test produced no JUnit report (exit ${run.exitCode})\n${run.stderr.slice(0, 2000)}`,
        }
      }

      const executed = run.tests.filter((t) => t.status !== "skipped")
      const tests = run.tests.map((t) => ({
        id: t.id,
        name: t.name,
        fileName: t.file,
        timeSpentMs: t.timeMs,
        status:
          t.status === "failure"
            ? TestStatus.Failed
            : t.status === "skipped"
              ? TestStatus.Skipped
              : TestStatus.Success,
        ...(t.failureMessage ? { failureMessage: t.failureMessage } : {}),
      }))

      let mutantCoverage
      if (coverageAnalysis !== "off") {
        const raw = run.out?.mutantCoverage
        mutantCoverage = { static: raw?.static ?? {}, perTest: {} }
        const rawPerTest = raw?.perTest ?? {}
        if (run.out?.executedTests !== executed.length) {
          // The seq<->JUnit pairing only holds when every executed test was
          // counted; on mismatch, degrade to static (correct, just slower)
          // instead of risking misattribution.
          logger.warn(
            "per-test pairing mismatch (preload counted %s, junit lists %s) — treating all coverage as static",
            String(run.out?.executedTests),
            String(executed.length),
          )
          for (const counters of Object.values(rawPerTest)) {
            for (const [mutantId, count] of Object.entries(counters)) {
              mutantCoverage.static[mutantId] = (mutantCoverage.static[mutantId] ?? 0) + count
            }
          }
        } else {
          for (const [key, counters] of Object.entries(rawPerTest)) {
            const test = executed[Number(key.slice(1))]
            if (test) {
              mutantCoverage.perTest[test.id] = counters
            }
          }
        }
      }

      return { status: DryRunStatus.Complete, tests, mutantCoverage }
    },

    async mutantRun({ activeMutant, testFilter, timeout, hitLimit, disableBail }) {
      const files = testFilter
        ? [...new Set(testFilter.map((id) => id.slice(0, id.indexOf("#"))))]
        : undefined
      const run = await runBun({
        files,
        activeMutantId: activeMutant.id,
        hitLimit,
        timeoutMs: timeout,
        bail: !disableBail,
      })

      if (run.timedOut) {
        return { status: MutantRunStatus.Timeout }
      }
      if (hitLimit !== undefined && run.out) {
        const reached = determineHitLimitReached(run.out.hitCount, hitLimit)
        if (reached) {
          return { status: MutantRunStatus.Timeout, reason: reached.reason }
        }
      }
      const failed = run.tests?.filter((t) => t.status === "failure") ?? []
      if (
        run.stderr.includes(HIT_LIMIT_MESSAGE) ||
        failed.some((t) => t.failureMessage?.includes(HIT_LIMIT_MESSAGE))
      ) {
        return { status: MutantRunStatus.Timeout, reason: "Hit limit reached" }
      }
      const nrOfTests = run.tests?.filter((t) => t.status !== "skipped").length ?? 0
      if (run.exitCode !== 0) {
        // Failed tests kill the mutant; so does a crash outside test bodies
        // (module load, lifecycle hook) — bun then exits non-zero WITHOUT
        // writing the JUnit report, and no test can pass under such a mutant
        // (command-runner semantics). The dry run already proved the suite
        // itself runs, so a non-zero exit here is attributable to the mutant.
        return {
          status: MutantRunStatus.Killed,
          killedBy: failed.length > 0 ? failed.map((t) => t.id) : ["unknown"],
          failureMessage:
            failed[0]?.failureMessage ??
            `suite crashed under mutant (exit ${run.exitCode})\n${run.stderr.slice(0, 500)}`,
          nrOfTests,
        }
      }
      if (!run.tests) {
        // bun reported success but the reporter wrote nothing: runner-side
        // defect, not a mutant effect — surface it instead of guessing.
        return {
          status: MutantRunStatus.Error,
          errorMessage: `bun test exited 0 but produced no JUnit report\n${run.stderr.slice(0, 2000)}`,
        }
      }
      return { status: MutantRunStatus.Survived, nrOfTests }
    },

    async dispose() {
      rmSync(workDir, { recursive: true, force: true })
    },
  }
}

createBunTestRunner.inject = tokens(commonTokens.logger, commonTokens.options)

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.TestRunner, "tskm-bun", createBunTestRunner),
]

export const strykerValidationSchema = {
  properties: {
    bun: {
      title: "BunRunnerOptions",
      type: "object",
      additionalProperties: false,
      properties: {
        bunPath: { type: "string" },
        timeout: {
          type: "number",
          description: "per-test timeout in ms, passed to bun test --timeout",
        },
      },
    },
  },
}
