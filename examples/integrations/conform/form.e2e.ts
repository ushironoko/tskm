import "./register-dom.ts"
import { expect, test } from "bun:test"
import { configureForms } from "@conform-to/react/future"
import { email, minLength, object, pipe, string } from "@tskm/core"
import { createElement } from "react"
import { createRoot } from "react-dom/client"

// Conform's default `configureForms()` treats any Standard Schema as a schema
// (`~standard.version === 1`) and validates with `schema["~standard"].validate`.
// No `isSchema` / `validateSchema` override is passed.
//
// The payload is the form submission: every control value is a string. A
// `number()` field therefore rejects `"36"`. This sample validates the strings
// Conform actually submits.
const profileSchema = object({
  name: pipe(string(), minLength(1)),
  email: pipe(string(), email()),
})

const { useForm } = configureForms()

type SubmitResult =
  | { readonly kind: "submit"; readonly value: unknown }
  | { readonly kind: "error"; readonly fieldErrors: Record<string, readonly string[]> }

function submit(values: { readonly name: string; readonly email: string }) {
  return new Promise<SubmitResult>((resolve, reject) => {
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    const timer = setTimeout(() => {
      root.unmount()
      host.remove()
      reject(new Error("conform form did not settle"))
    }, 1000)

    function finish(result: SubmitResult) {
      clearTimeout(timer)
      root.unmount()
      host.remove()
      resolve(result)
    }

    function Probe() {
      const { form, fields } = useForm(profileSchema, {
        defaultValue: values,
        onSubmit(_event, ctx) {
          finish({ kind: "submit", value: ctx.value })
        },
        onError(ctx) {
          const fieldErrors = ctx.error?.fieldErrors
          finish({
            kind: "error",
            fieldErrors:
              fieldErrors && typeof fieldErrors === "object"
                ? (fieldErrors as Record<string, readonly string[]>)
                : {},
          })
        },
      })
      return createElement(
        "form",
        form.props,
        createElement("input", { name: fields.name.name, defaultValue: values.name }),
        createElement("input", { name: fields.email.name, defaultValue: values.email }),
        createElement("button", { type: "submit" }, "Save"),
      )
    }

    root.render(createElement(Probe))
    setTimeout(() => {
      const form = host.querySelector("form")
      if (!form) {
        clearTimeout(timer)
        root.unmount()
        host.remove()
        reject(new Error("form was not rendered"))
        return
      }
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
    }, 20)
  })
}

test("conform future useForm accepts a tskm schema", async () => {
  const result = await submit({ name: "Ada", email: "ada@example.com" })
  expect(result).toEqual({
    kind: "submit",
    value: { name: "Ada", email: "ada@example.com" },
  })
})

test("conform future useForm rejects an invalid submission", async () => {
  const result = await submit({ name: "", email: "not-an-email" })
  expect(result.kind).toBe("error")
  if (result.kind !== "error") return
  expect(result.fieldErrors.name?.length).toBeGreaterThan(0)
  expect(result.fieldErrors.email?.length).toBeGreaterThan(0)
})
