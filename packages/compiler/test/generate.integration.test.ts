import * as compiler from "../src/index.ts"
import { registerSuite } from "./runners/bun.ts"
import { basicSuite } from "./scenarios/generate.ts"

// The sidecar gate runs on both runtimes. The scenarios live in scenarios/generate.ts.
registerSuite(basicSuite(compiler))
