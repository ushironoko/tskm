import "./monacoBootstrap.ts"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { defineTskmMonacoTheme } from "./components/MonacoEditor.tsx"
import "./styles.css"

defineTskmMonacoTheme()

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
