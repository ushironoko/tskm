import { expect, test } from "bun:test"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { userSchema } from "../src/user-schema.ts"

const rootRoute = createRootRoute()
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: userSchema,
})
const routeTree = rootRoute.addChildren([indexRoute])

async function loadAt(href: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [href] }),
  })
  await router.load()
  const match = router.state.matches.find((entry) => entry.routeId === indexRoute.id)
  if (!match) throw new Error(`index route was not matched for ${href}`)
  return { search: router.state.location.search, match }
}

test("tanstack router validateSearch accepts a tskm schema", async () => {
  const loaded = await loadAt("/?name=Ada&email=ada@example.com&age=36")
  expect(loaded.match.status).toBe("success")
  expect(loaded.search).toEqual({
    name: "Ada",
    email: "ada@example.com",
    age: 36,
  })
})

test("tanstack router validateSearch rejects an invalid search", async () => {
  // Search validation throws inside route matching. `load()` still resolves and
  // records the SearchParamError on the index match.
  const loaded = await loadAt("/?name=&email=not-an-email&age=nope")
  expect(loaded.match.status).toBe("error")
  expect(loaded.match.error).toBeDefined()
})
