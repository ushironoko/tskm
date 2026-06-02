#!/usr/bin/env node
import { main } from "./cli-core.ts"

// Thin executable shim: all CLI logic lives in `cli-core.ts` (side-effect free, so it is
// unit-testable in-process); this entry only wires `main` to the process and exit code.
main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exitCode = 1
})
