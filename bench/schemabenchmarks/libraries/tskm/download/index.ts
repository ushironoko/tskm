import { parse } from "@tskm/core"

import type { Product } from "../index.gen.ts"
import { productSchema } from "../index.ts"

export type ParsedProduct = Product

parse(productSchema, {})
