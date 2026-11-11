import * as compiler from "../src/index.ts"
import { registerSuite } from "./runners/suite.ts"
import { inplaceSuite } from "./scenarios/generate.ts"

// Inplace rewrites a throwaway schema under the fixture's `src/`. The scenarios live in
// scenarios/generate.ts and run on both runtimes.
registerSuite(inplaceSuite(compiler))
