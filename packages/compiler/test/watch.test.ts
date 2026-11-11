import { planWatchActions, type WatchEvent, type WatchPlanContext } from "../src/watch.ts"
import { describe, expect, it } from "./test-api.ts"

const root = "/proj"
const tsconfig = `${root}/tsconfig.json`
const sourceA = `${root}/src/a.ts`
const sourceB = `${root}/src/b.ts`

const ctx: WatchPlanContext = {
  tsconfigPath: tsconfig,
  knownSources: new Set([sourceA, sourceB]),
  isCurrent: () => false,
}

function change(path: string): WatchEvent {
  return { path, kind: "change" }
}

function rename(path: string): WatchEvent {
  return { path, kind: "rename" }
}

describe("planWatchActions — the gate", () => {
  it("regenerates only a changed known source", () => {
    expect(planWatchActions([change(sourceA)], ctx)).toEqual({
      full: false,
      files: [sourceA],
    })
  })

  it("forces a full rebuild when the tsconfig changes", () => {
    expect(planWatchActions([change(tsconfig)], ctx)).toEqual({
      full: true,
      files: [],
    })
  })

  it("forces a full rebuild on a rename (file added/removed)", () => {
    const plan = planWatchActions([rename(`${root}/src/c.ts`)], ctx)
    expect(plan.full).toBe(true)
    expect(plan.files).toEqual([])
  })

  it("forces a full rebuild on a change to a .ts outside knownSources", () => {
    const plan = planWatchActions([change(`${root}/src/util.ts`)], ctx)
    expect(plan.full).toBe(true)
    expect(plan.files).toEqual([])
  })

  it("drops generated artifacts", () => {
    const plan = planWatchActions(
      [change(`${root}/src/a.gen.ts`), change(`${root}/src/b.schema.json`)],
      ctx,
    )
    expect(plan).toEqual({ full: false, files: [] })
  })

  it("dedupes repeated changes to the same source", () => {
    const plan = planWatchActions([change(sourceA), change(sourceA)], ctx)
    expect(plan).toEqual({ full: false, files: [sourceA] })
  })

  it("discards accumulated source changes once any event forces a full rebuild", () => {
    const plan = planWatchActions([change(sourceA), rename(`${root}/src/c.ts`)], ctx)
    expect(plan).toEqual({ full: true, files: [] })
  })
})

describe("planWatchActions — content over events", () => {
  // Stands in for session.isCurrent: these sources' outputs match their content.
  const current = (...paths: string[]): WatchPlanContext => ({
    ...ctx,
    isCurrent: (path) => paths.includes(path),
  })

  it("drops a change to a known source whose output is current", () => {
    expect(planWatchActions([change(sourceA)], current(sourceA))).toEqual({
      full: false,
      files: [],
    })
  })

  it("still regenerates a known source whose output is not current", () => {
    expect(planWatchActions([change(sourceA)], current(sourceB))).toEqual({
      full: false,
      files: [sourceA],
    })
  })

  it("drops a rename of a known source whose output is current", () => {
    expect(planWatchActions([rename(sourceA)], current(sourceA))).toEqual({
      full: false,
      files: [],
    })
  })

  it("keeps a rename of a known source whose output is not current a full rebuild", () => {
    expect(planWatchActions([rename(sourceA)], current())).toEqual({ full: true, files: [] })
  })

  it("does not let a current source hide a structural change in the same batch", () => {
    const plan = planWatchActions([change(sourceA), rename(`${root}/src/c.ts`)], current(sourceA))
    expect(plan).toEqual({ full: true, files: [] })
  })

  it("consults isCurrent only for known sources", () => {
    const util = `${root}/src/util.ts`
    expect(planWatchActions([change(util)], current(util))).toEqual({ full: true, files: [] })
  })
})
