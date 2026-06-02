import { describe, expect, it } from "vitest"
import { planWatchActions, type WatchEvent, type WatchPlanContext } from "../src/watch.ts"

const root = "/proj"
const tsconfig = `${root}/tsconfig.json`
const sourceA = `${root}/src/a.ts`
const sourceB = `${root}/src/b.ts`

const ctx: WatchPlanContext = {
  tsconfigPath: tsconfig,
  knownSources: new Set([sourceA, sourceB]),
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
