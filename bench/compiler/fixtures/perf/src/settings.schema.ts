import { boolean, type Infer, literal, number, object, picklist, string, union } from "@tskm/core"

export const themeSchema = picklist(["light", "dark", "system"])
export type Theme = Infer<typeof themeSchema>

export const settingsSchema = object({
  theme: themeSchema,
  fontSize: number(),
  notifications: object({
    email: boolean(),
    push: boolean(),
    frequency: union([literal("instant"), literal("daily"), literal("weekly")]),
  }),
  locale: string(),
})
export type Settings = Infer<typeof settingsSchema>
