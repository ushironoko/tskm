// Minimal parser for bun test's own JUnit output. Input is machine-generated
// by a single known serializer, so a tag/attribute scanner is sufficient — no
// XML dependency. Test identity is reconstructed from the NESTED testsuite
// hierarchy, not the `classname` attribute (bun writes classname with the
// describe path reversed).

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

function decode(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    }
    return ENTITIES[body] ?? whole
  })
}

function attrs(raw) {
  const out = {}
  for (const m of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    out[m[1]] = decode(m[2])
  }
  return out
}

/**
 * @returns {Array<{id: string, name: string, file: string, status: "pass"|"failure"|"skipped", timeMs: number, failureMessage?: string}>}
 *   Testcases in document order (= bun's execution order).
 */
export function parseJunit(xml) {
  const tests = []
  // describe-path stack; the first testsuite level is the file, skipped here
  // because the testcase `file` attribute already carries it.
  const suites = []
  let depth = 0
  let current = null
  const tag = /<(\/?)([\w:-]+)((?:[^>"]|"[^"]*")*?)(\/?)>/g
  for (const m of xml.matchAll(tag)) {
    const [, closing, name, rawAttrs, selfClosing] = m
    if (name === "testsuite") {
      if (closing) {
        depth--
        if (depth >= 1) suites.pop()
      } else if (!selfClosing) {
        depth++
        if (depth >= 2) suites.push(attrs(rawAttrs).name ?? "")
      }
      continue
    }
    if (name === "testcase") {
      if (closing) {
        current = null
        continue
      }
      const a = attrs(rawAttrs)
      const test = {
        id: `${a.file ?? ""}#${[...suites, a.name ?? ""].join(" > ")}`,
        name: [...suites, a.name ?? ""].join(" > "),
        file: a.file ?? "",
        status: "pass",
        timeMs: Math.round(Number(a.time ?? 0) * 1000),
      }
      tests.push(test)
      current = selfClosing ? null : test
      continue
    }
    if (current && !closing && (name === "failure" || name === "error")) {
      current.status = "failure"
      const message = attrs(rawAttrs).message
      if (message && !current.failureMessage) current.failureMessage = message
      continue
    }
    if (current && !closing && name === "skipped") {
      current.status = "skipped"
    }
  }
  return tests
}
