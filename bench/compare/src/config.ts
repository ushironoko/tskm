/**
 * Fixed procedure. Change these only by re-running and replacing RESULTS.md.
 *
 * Speed: every library runs in its own fresh process. A process warms up both payloads, then
 * times `measuredIterations` valid parses and `measuredIterations` invalid parses. The
 * processes are interleaved, so each round visits every library once. `measuredRounds`
 * rounds give a median and a min..max range per library.
 */
export const warmupIterations = 100_000
export const measuredIterations = 100_000
export const measuredRounds = 5
export const memoryParses = 50_000
export const typeCopies = 100
/** Each checker runs this many times per library; the check time reported is the median. */
export const typeRepeats = 3

export const libraries = ["tskm", "zod", "valibot", "arktype", "typebox", "effect"] as const

export type LibraryName = (typeof libraries)[number]

/**
 * Extra entry points, measured for bundle size only (and checked by the agreement gate).
 * zod's classic entry is about four times the gzip size of `zod/mini`, zod's own small-bundle
 * entry, so the bundle table shows both.
 */
export const referenceLibraries = ["zod-mini"] as const

export type ReferenceName = (typeof referenceLibraries)[number]
