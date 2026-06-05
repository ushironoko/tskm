import { object, string } from "@tskm/core"
import { z } from "zod"

export const coreSchema = object({ id: string() })

export const zodSchema = z.object({ label: z.string() })
