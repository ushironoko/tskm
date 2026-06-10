import { describe, expect, it } from "bun:test"
import { parseJunit } from "./junit.mjs"

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="5" failures="1" skipped="2" time="0.1">
  <testsuite name="b.test.ts" file="b.test.ts" tests="5" failures="1" skipped="2" time="0">
    <testsuite name="outer" file="b.test.ts" line="2" tests="4" failures="1" skipped="1" time="0">
      <testsuite name="inner &amp; co" file="b.test.ts" line="3" tests="1" failures="0" skipped="0" time="0.003">
        <testcase name="quotes &quot;x&quot; &amp; entities &gt; ok" classname="x" time="0.003" file="b.test.ts" line="4" />
      </testsuite>
      <testcase name="fails" classname="outer" time="0.0001" file="b.test.ts" line="6">
        <failure message="expect(received).toBe(expected)" type="AssertionError"></failure>
      </testcase>
      <testcase name="skipped one" classname="outer" time="0" file="b.test.ts" line="7">
        <skipped/>
      </testcase>
    </testsuite>
    <testcase name="top pass" classname="" time="0.00002" file="b.test.ts" line="9" />
    <testcase name="todo one" classname="" time="0" file="b.test.ts" line="10">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>`

describe("parseJunit", () => {
  const tests = parseJunit(sample)

  it("returns testcases in document order with describe paths from the suite nesting", () => {
    expect(tests.map((t) => t.name)).toEqual([
      'outer > inner & co > quotes "x" & entities > ok',
      "outer > fails",
      "outer > skipped one",
      "top pass",
      "todo one",
    ])
  })

  it("prefixes ids with the file so they stay parseable by the runner", () => {
    expect(tests[0]?.id).toBe('b.test.ts#outer > inner & co > quotes "x" & entities > ok')
    for (const t of tests) {
      expect(t.id.slice(0, t.id.indexOf("#"))).toBe("b.test.ts")
    }
  })

  it("classifies pass, failure, and skipped (including self-closing testcases)", () => {
    expect(tests.map((t) => t.status)).toEqual(["pass", "failure", "skipped", "pass", "skipped"])
  })

  it("captures the failure message and converts time to ms", () => {
    expect(tests[1]?.failureMessage).toBe("expect(received).toBe(expected)")
    expect(tests[0]?.timeMs).toBe(3)
  })

  it("decodes numeric character references", () => {
    const [t] = parseJunit(
      '<testsuites><testsuite name="a.ts" file="a.ts"><testcase name="dash &#x2014; and &#65;" classname="" time="0" file="a.ts"/></testsuite></testsuites>',
    )
    expect(t?.name).toBe("dash — and A")
  })
})
