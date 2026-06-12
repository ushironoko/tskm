import { createdBundledHighlighter, type HighlighterGeneric } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

export type PlaygroundLanguage = "typescript" | "json"
export type PlaygroundTheme = "github-light"
export type PlaygroundHighlighter = HighlighterGeneric<PlaygroundLanguage, PlaygroundTheme>

export const createPlaygroundHighlighter = createdBundledHighlighter({
  langs: {
    typescript: () => import("shiki/langs/typescript.mjs"),
    json: () => import("shiki/langs/json.mjs"),
  },
  themes: {
    "github-light": () => import("shiki/themes/github-light.mjs"),
  },
  engine: () => createJavaScriptRegexEngine(),
})
