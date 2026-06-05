import { type } from "arktype"

export const user = type({
  name: "string",
  "age?": "number",
})
