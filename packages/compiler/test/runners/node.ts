import { after, describe, it } from "node:test"
import type { Suite } from "../scenarios/support.ts"

/** Registers a shared scenario suite with `node:test`, under the suite's own title. */
export function registerSuite(suite: Suite): void {
  describe(suite.title, () => {
    if (suite.teardown) {
      after(suite.teardown)
    }
    for (const scenario of suite.scenarios) {
      it(scenario.name, { timeout: scenario.timeout }, scenario.run)
    }
  })
}
