import { recursive } from "@foreign"

// Built with a NON-tskm `recursive` helper: discovery flags it core-recursive by name,
// but the worker's vendor gate rejects it (vendor !== "tskm"). Expected: skipped with a
// diagnostic, no foreign.schema.gen.ts — never an empty alias.
export const foreignSchema = recursive((self) => self)
