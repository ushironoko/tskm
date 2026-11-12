import type { Satisfies } from "@schema-benchmarks/utils"
import {
  array,
  date,
  type InferOutput,
  maxLength,
  maxValue,
  minLength,
  minValue,
  nullable,
  number,
  object,
  picklist,
  pipe,
  string,
  url,
} from "@tskm/core"

import type { ProductData } from "#src"

function boundedString(min: number, max: number) {
  return pipe(string(), minLength(min), maxLength(max))
}

function boundedNumber(min: number, max: number) {
  return pipe(number(), minValue(min), maxValue(max))
}

export const imageSchema = object({
  id: number(),
  created: date(),
  title: boundedString(1, 100),
  type: picklist(["jpg", "png"]),
  size: number(),
  url: pipe(string(), url()),
})

export const ratingSchema = object({
  id: number(),
  stars: boundedNumber(1, 5),
  title: boundedString(1, 100),
  text: boundedString(1, 1_000),
  images: array(imageSchema),
})

export const productSchema = object({
  id: number(),
  created: date(),
  title: boundedString(1, 100),
  brand: boundedString(1, 30),
  description: boundedString(1, 500),
  price: boundedNumber(1, 10_000),
  discount: nullable(boundedNumber(1, 100)),
  quantity: boundedNumber(0, 10),
  tags: array(boundedString(1, 30)),
  images: array(imageSchema),
  ratings: array(ratingSchema),
})

export type SatisfiesTest = Satisfies<InferOutput<typeof productSchema>, ProductData>
