---
"@tskm/core": minor
"@tskm/compiler": minor
---

Add `preprocess` / `preprocessAsync`.

`preprocess(fn, schema)` maps an untrusted value before the inner schema validates it. The caller writes the conversion. The input type is `unknown`. The output type stays the inner schema's output (`PreprocessSchema<TWrapped>`). A throw or rejection becomes a `type: "preprocess"` issue and the inner schema does not run. Non-`Error` throws use `String(error)`.

The compiler's structural TypeScript walker and JSON Schema walker both unwrap `type: "preprocess"` to the inner output shape. JSON Schema warns that the emitted schema is the output shape and that the input accepts any value.
