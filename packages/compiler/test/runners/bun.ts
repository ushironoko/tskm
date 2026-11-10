import { afterAll, describe, it } from "bun:test"
import type { Suite } from "../scenarios/support.ts"

/** Registers a shared scenario suite with `bun:test`, under the suite's own title. */
export function registerSuite(suite: Suite): void {
  describe(suite.title, () => {
    if (suite.teardown) {
      afterAll(suite.teardown)
    }
    for (const scenario of suite.scenarios) {
      it(scenario.name, scenario.run, scenario.timeout)
    }
  })
}
