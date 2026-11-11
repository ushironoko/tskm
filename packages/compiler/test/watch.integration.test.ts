import * as compiler from "../src/index.ts"
import { registerSuite } from "./runners/suite.ts"
import { watchSuites } from "./scenarios/watch.ts"

// The watch runtime (fs.watch, debounce, abort) against the real checker, on both runtimes.
// The scenarios live in scenarios/watch.ts.
for (const suite of watchSuites(compiler)) {
  registerSuite(suite)
}
