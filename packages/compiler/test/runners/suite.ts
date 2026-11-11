import type { Suite } from "../scenarios/support.ts"
import { afterAll, describe, it } from "../test-api.ts"

/** Registers a shared scenario suite under the test API, with the suite's own title. */
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
