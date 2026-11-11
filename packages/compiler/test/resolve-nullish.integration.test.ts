import * as compiler from "../src/index.ts"
import { registerSuite } from "./runners/suite.ts"
import { nullishSuite } from "./scenarios/generate.ts"

// Real-tsgo gate for TOP-LEVEL nullability. The existing `account` gate only exercises
// `nullable`/`optional` *inside* an `object`, where the `& {}` of the `__P` query wrapper
// is applied at the object level and never touches the property values. A top-level
// `nullable`/`nullish`/`union([…, null_()])` is the one shape that flows the bare union
// straight through `__P` — the precise spot where `null`/`undefined` could be dropped.
// The scenario is shared with the Node run (scenarios/generate.ts).
registerSuite(nullishSuite(compiler))
