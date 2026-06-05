import { z } from "zod"

// A LOCAL (non-exported) type smuggled into the inferred output through a type
// argument — NOT a variable annotation, so discovery captures no
// recursiveAnnotation and the resolve-side skip cannot fire. The rendered type
// references `LocalThing` bare; the sidecar would fail TS2304. This is the
// post-resolution compile gate's case: nothing may be written.
type LocalThing = { x: number }

export const weirdSchema = z.object({
  thing: z.custom<LocalThing>(),
})
