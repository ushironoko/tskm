import { array, type Infer, number, object, record, string } from "@tskm/core"

export const sampleSchema = object({
  t: number(),
  value: number(),
  labels: record(string(), string()),
})
export type Sample = Infer<typeof sampleSchema>

export const seriesSchema = object({
  metric: string(),
  unit: string(),
  samples: array(sampleSchema),
})
export type Series = Infer<typeof seriesSchema>

export const reportSchema = object({
  generatedAt: number(),
  series: array(seriesSchema),
})
export type Report = Infer<typeof reportSchema>
