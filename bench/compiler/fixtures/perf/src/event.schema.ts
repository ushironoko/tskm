import { array, boolean, type Infer, number, object, optional, string, tuple } from "@tskm/core"

export const coordSchema = tuple([number(), number(), number()])
export type Coord = Infer<typeof coordSchema>

export const eventSchema = object({
  id: string(),
  name: string(),
  at: number(),
  location: coordSchema,
  attendees: array(
    object({
      userId: string(),
      rsvp: boolean(),
      note: optional(string()),
    }),
  ),
})
export type Event = Infer<typeof eventSchema>
