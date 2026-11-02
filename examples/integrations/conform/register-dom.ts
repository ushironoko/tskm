import { Window } from "happy-dom"

const dom = new Window({ url: "https://example.com/" })

function install(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  })
}

install("window", dom)
install("document", dom.document)
install("navigator", dom.navigator)
install("HTMLElement", dom.HTMLElement)
install("HTMLFormElement", dom.HTMLFormElement)
install("HTMLInputElement", dom.HTMLInputElement)
install("HTMLButtonElement", dom.HTMLButtonElement)
install("HTMLFieldSetElement", dom.HTMLFieldSetElement)
install("Element", dom.Element)
install("Node", dom.Node)
install("Event", dom.Event)
install("SubmitEvent", dom.SubmitEvent)
install("FormData", dom.FormData)
install("MutationObserver", dom.MutationObserver)
install("getComputedStyle", dom.getComputedStyle.bind(dom))
install("requestAnimationFrame", dom.requestAnimationFrame.bind(dom))
install("cancelAnimationFrame", dom.cancelAnimationFrame.bind(dom))
