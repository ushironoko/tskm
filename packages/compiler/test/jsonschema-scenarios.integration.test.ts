import * as compiler from "../src/index.ts"
import { registerSuite } from "./runners/suite.ts"
import { jsonSchemaSuite } from "./scenarios/json-schema.ts"

// The JSON Schema fail-closed scenarios against the Bun source. The same suite runs under Node
// against the built package in node-integration.ts.
registerSuite(jsonSchemaSuite(compiler))
