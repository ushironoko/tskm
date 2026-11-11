import * as compiler from "../src/index.ts"
import { registerSuite } from "./runners/suite.ts"
import { standardSuites } from "./scenarios/standard.ts"

// Standard Schema interop (zod, valibot, arktype) against the real checker. The scenarios
// live in scenarios/standard.ts and run on both runtimes.
for (const suite of standardSuites(compiler)) {
  registerSuite(suite)
}
