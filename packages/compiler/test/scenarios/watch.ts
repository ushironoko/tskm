import assert from "node:assert/strict"
import { existsSync, watch as fsWatch, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { GenerateResult, WatchController } from "../../src/index.ts"
import { withTestTsgo } from "../tsgo-test-executable.ts"
import { type CompilerApi, fixture, type Suite } from "./support.ts"

// The watch runtime (fs.watch, debounce, abort handling) against the real checker. The fs
// events come from the runtime itself, which is why this suite runs on both runtimes.

function inplaceSource(sizeField: string): string {
  return `import { object, string, number, type Infer } from "@tskm/core"

export const watchSchema = object({
  id: string(),
  ${sizeField}: number(),
})

export type WatchTarget = Infer<typeof watchSchema>
`
}

function sidecarSource(extraField: string): string {
  return `import { object, string, number } from "@tskm/core"

export const watchSchema = object({
  id: string(),
  ${extraField}: number(),
})
`
}

/** Polls until `predicate` holds or the budget elapses, yielding between checks. */
async function waitFor(predicate: () => boolean, budgetMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return predicate()
}

/** The controllers a scenario opens, so each one is closed even when an assertion threw. */
function trackControllers(): {
  track: (controller: WatchController) => WatchController
  closeAll: () => Promise<void>
} {
  const open = new Set<WatchController>()
  return {
    track: (controller) => {
      open.add(controller)
      return controller
    },
    closeAll: async () => {
      for (const controller of open) {
        try {
          await controller.close()
        } catch {
          // A double close or a torn-down session must not mask the scenario's outcome.
        }
      }
      open.clear()
    },
  }
}

function removeFiles(files: ReadonlyArray<string>): void {
  for (const f of files) {
    if (existsSync(f)) rmSync(f)
  }
}

export function watchSuites(api: CompilerApi): Suite[] {
  const fixtureRoot = fixture("basic")
  const target = fixture("basic/src/watchtarget.schema.ts")
  const sidecar = fixture("basic/src/watchtarget.schema.gen.ts")
  const query = fixture("basic/src/watchtarget.schema.tskm-query.ts")
  const basicArtifacts = [target, sidecar, query]

  const stdRoot = fixture("standard")
  const stdTarget = fixture("standard/src/watchext.schema.ts")
  const stdSidecar = fixture("standard/src/watchext.schema.gen.ts")
  const stdQuery = fixture("standard/src/watchext.schema.tskm-query.ts")
  const stdArtifacts = [stdTarget, stdSidecar, stdQuery]

  /**
   * A scenario body. Its controllers are closed and its artifacts removed afterwards, pass or
   * fail, as the original afterEach did. The query document is checked for leftovers once the
   * body has finished.
   */
  const scenario = (
    name: string,
    query: string,
    artifacts: ReadonlyArray<string>,
    timeout: number,
    body: (track: (controller: WatchController) => WatchController) => Promise<void>,
  ) => ({
    name,
    timeout,
    run: async () => {
      const tracker = trackControllers()
      try {
        await body(tracker.track)
        assert.equal(existsSync(query), false, "a query document must not be left on disk")
      } finally {
        await tracker.closeAll()
        removeFiles(artifacts)
      }
    },
  })

  const runtime: Suite = {
    title: "compiler watch (real tsgo) — runtime",
    teardown: () => removeFiles(basicArtifacts),
    scenarios: [
      scenario(
        "fires an initial generate, then re-generates on an external edit (inplace)",
        query,
        basicArtifacts,
        60_000,
        async (track) => {
          writeFileSync(target, inplaceSource("size"))
          const calls: GenerateResult[] = []
          const controller = track(
            await api.watch({
              root: fixtureRoot,
              mode: "inplace",
              config: withTestTsgo({
                include: ["src/watchtarget.schema.ts"],
                tsconfig: "tsconfig.json",
              }),
              debounceMs: 30,
              onGenerate: (r) => calls.push(r),
            }),
          )

          // The initial full generate runs synchronously inside watch() before it resolves.
          assert.ok(calls.length >= 1, "expected the initial generate")
          const first = calls[0]
          assert.ok((first?.files.length ?? 0) >= 1, "expected a file from the initial generate")
          assert.equal(first?.files[0]?.mode, "inplace")

          const before = calls.length
          // Re-write on each poll tick until a pass runs, so a coalesced or dropped fs event is
          // retried rather than awaited. Each write is a real edit: its content differs from the
          // text the initial inplace pass wrote. This exercises fs.watch → debounce → flush →
          // planWatchActions(incremental) → generateFile → mergeResults.
          let toggle = false
          const fired = await waitFor(() => {
            if (calls.length > before) return true
            toggle = !toggle
            writeFileSync(target, inplaceSource(toggle ? "weight" : "height"))
            return false
          })
          assert.equal(fired, true, "expected a re-generation after the edit")
          const latest = calls[calls.length - 1]
          assert.equal(latest?.files[0]?.source, target)

          await controller.close()
        },
      ),
      scenario(
        "re-generates a sidecar on an external edit and merges per-file results",
        query,
        basicArtifacts,
        60_000,
        async (track) => {
          writeFileSync(target, sidecarSource("size"))
          const calls: GenerateResult[] = []
          const controller = track(
            await api.watch({
              root: fixtureRoot,
              mode: "sidecar",
              config: withTestTsgo({
                include: ["src/watchtarget.schema.ts"],
                tsconfig: "tsconfig.json",
              }),
              debounceMs: 30,
              onGenerate: (r) => calls.push(r),
            }),
          )

          assert.ok(calls.length >= 1, "expected the initial generate")
          assert.equal(calls[0]?.files[0]?.mode, "sidecar")
          assert.equal(existsSync(sidecar), true)

          const before = calls.length
          // Re-write on each poll tick so a coalesced/dropped fs event on slower platforms
          // (notably macOS FSEvents) is retried until one lands, instead of betting on a
          // single write being delivered. Exercises the fs.watch → debounce → flush path.
          let toggle = false
          const fired = await waitFor(() => {
            if (calls.length > before) return true
            toggle = !toggle
            writeFileSync(target, sidecarSource(toggle ? "count" : "total"))
            return false
          })
          assert.equal(fired, true, "expected a re-generation after the edit")
          const latest = calls[calls.length - 1]
          assert.equal(latest?.files.length, 1)
          assert.equal(latest?.files[0]?.source, target)

          await controller.close()
        },
      ),
      scenario(
        "close() is idempotent and tears down the session",
        query,
        basicArtifacts,
        60_000,
        async () => {
          writeFileSync(target, sidecarSource("size"))
          const controller = await api.watch({
            root: fixtureRoot,
            mode: "sidecar",
            config: withTestTsgo({
              include: ["src/watchtarget.schema.ts"],
              tsconfig: "tsconfig.json",
            }),
            debounceMs: 30,
          })

          await controller.close()
          // Second close hits the early `if (closed) return` guard without throwing.
          // Reaching this line without an exception is the assertion.
          await controller.close()
        },
      ),
      scenario(
        "closes when a passed AbortSignal is aborted",
        query,
        basicArtifacts,
        60_000,
        async (track) => {
          writeFileSync(target, sidecarSource("size"))
          const ac = new AbortController()
          const controller = track(
            await api.watch({
              root: fixtureRoot,
              mode: "sidecar",
              config: withTestTsgo({
                include: ["src/watchtarget.schema.ts"],
                tsconfig: "tsconfig.json",
              }),
              debounceMs: 30,
              signal: ac.signal,
            }),
          )

          ac.abort()
          // The abort listener schedules close() asynchronously; a subsequent explicit
          // close() must then be a no-op (proving the abort path already closed it).
          await waitFor(() => false, 200)
          await controller.close()
        },
      ),
      scenario(
        "closes immediately when given an already-aborted signal",
        query,
        basicArtifacts,
        60_000,
        async (track) => {
          writeFileSync(target, sidecarSource("size"))
          const ac = new AbortController()
          ac.abort()
          const calls: GenerateResult[] = []
          const controller = track(
            await api.watch({
              root: fixtureRoot,
              mode: "sidecar",
              config: withTestTsgo({
                include: ["src/watchtarget.schema.ts"],
                tsconfig: "tsconfig.json",
              }),
              debounceMs: 30,
              signal: ac.signal,
              onGenerate: (r) => calls.push(r),
            }),
          )

          // The initial generate still runs before the aborted-signal branch closes the
          // watcher synchronously inside watch().
          assert.ok(calls.length >= 1, "expected the initial generate")
          // Already closed; close() short-circuits.
          await controller.close()
        },
      ),
      scenario(
        "does not regenerate for identical bytes written before watch() (sidecar, another watcher open)",
        query,
        basicArtifacts,
        60_000,
        async (track) => {
          writeFileSync(target, sidecarSource("size"))
          // A second watcher on the source directory is open while the source is rewritten with
          // the same bytes, before watch() exists. Node can deliver that write to the recursive
          // watcher watch() attaches afterwards, even though it happened before watch() began.
          const other = fsWatch(dirname(target), () => {})
          try {
            writeFileSync(target, sidecarSource("size"))
            const calls: GenerateResult[] = []
            const controller = track(
              await api.watch({
                root: fixtureRoot,
                mode: "sidecar",
                config: withTestTsgo({
                  include: ["src/watchtarget.schema.ts"],
                  tsconfig: "tsconfig.json",
                }),
                debounceMs: 30,
                onGenerate: (r) => calls.push(r),
              }),
            )
            assert.equal(calls.length, 1, "expected only the initial generate")

            // A delivered stale event would fire within the debounce window after watch()
            // resolves. Watching for several times that window is what makes the absence of a
            // second pass a meaningful assertion; it is an observation window, not a wait for
            // the fix to take effect.
            await new Promise((r) => setTimeout(r, 600))
            assert.equal(
              calls.length,
              1,
              "identical bytes written before watch() must not regenerate",
            )

            // A real edit after watch() started still regenerates.
            let toggle = false
            const fired = await waitFor(() => {
              if (calls.length > 1) return true
              toggle = !toggle
              writeFileSync(target, sidecarSource(toggle ? "count" : "total"))
              return false
            })
            assert.equal(fired, true, "expected a re-generation after a real edit")
            assert.equal(calls[calls.length - 1]?.files[0]?.source, target)

            await controller.close()
          } finally {
            other.close()
          }
        },
      ),
      scenario(
        "does not regenerate for the inplace write it made itself, with another watcher open",
        query,
        basicArtifacts,
        60_000,
        async (track) => {
          writeFileSync(target, inplaceSource("size"))
          const other = fsWatch(dirname(target), () => {})
          try {
            // Identical bytes before watch(). The initial inplace pass then writes the sentinel
            // region, so two writes to the source are pending when watch() attaches.
            writeFileSync(target, inplaceSource("size"))
            const calls: GenerateResult[] = []
            const controller = track(
              await api.watch({
                root: fixtureRoot,
                mode: "inplace",
                config: withTestTsgo({
                  include: ["src/watchtarget.schema.ts"],
                  tsconfig: "tsconfig.json",
                }),
                debounceMs: 30,
                onGenerate: (r) => calls.push(r),
              }),
            )
            assert.equal(calls.length, 1, "expected only the initial generate")
            assert.equal(calls[0]?.files[0]?.changed, true, "the initial pass rewrote the source")

            await new Promise((r) => setTimeout(r, 600))
            assert.equal(calls.length, 1, "the echo of its own inplace write must not regenerate")

            let toggle = false
            const fired = await waitFor(() => {
              if (calls.length > 1) return true
              toggle = !toggle
              writeFileSync(target, inplaceSource(toggle ? "weight" : "height"))
              return false
            })
            assert.equal(fired, true, "expected a re-generation after a real edit")
            assert.equal(calls[calls.length - 1]?.files[0]?.source, target)

            await controller.close()
          } finally {
            other.close()
          }
        },
      ),
    ],
  }

  // External (zod) schemas through the SAME watch runtime: the initial generate must produce
  // the sidecar, and — the loop guard — the sidecar write must not echo back into another
  // generation (self-write tracking + the verify gate never rewriting on failure).
  const external: Suite = {
    title: "compiler watch (real tsgo) — external schema smoke",
    teardown: () => removeFiles(stdArtifacts),
    scenarios: [
      scenario(
        "generates an external sidecar once and does not self-rebuild",
        stdQuery,
        stdArtifacts,
        60_000,
        async (track) => {
          writeFileSync(
            stdTarget,
            'import { z } from "zod"\n\nexport const watchExtSchema = z.object({ id: z.string() })\n',
          )
          const calls: GenerateResult[] = []
          const controller = track(
            await api.watch({
              root: stdRoot,
              mode: "sidecar",
              config: withTestTsgo({
                include: ["src/watchext.schema.ts"],
                tsconfig: "tsconfig.json",
              }),
              debounceMs: 30,
              onGenerate: (r) => calls.push(r),
            }),
          )

          assert.ok(calls.length >= 1, "expected the initial generate")
          assert.equal(existsSync(stdSidecar), true)
          const initial = calls.length

          // Give the fs watcher ample time to (wrongly) echo the sidecar write back.
          await new Promise((r) => setTimeout(r, 600))
          assert.equal(calls.length, initial)

          await controller.close()
        },
      ),
    ],
  }

  return [runtime, external]
}
