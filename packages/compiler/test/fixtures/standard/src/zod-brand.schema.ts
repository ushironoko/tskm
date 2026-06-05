import { z } from "zod"

export const userIdSchema = z.string().brand<"UserId">()

export const cardSchema = z.object({
  id: z.string().brand<"CardId">(),
  label: z.string(),
})
