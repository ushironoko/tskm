import { defineConfig } from "vitest/config"

// Three lanes (Testing Trophy):
//  - unit:        pure, fast logic (runtime behavior + compiler IR/print/emit on fixtures)
//  - type:        type-level assertions via `*.test-d.ts` (expectTypeOf / @ts-expect-error)
//  - integration: spawns the real tsgo (native-preview) checker; slow
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts"],
          exclude: ["packages/*/test/**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "type",
          include: ["packages/*/test/**/*.test-d.ts"],
          typecheck: {
            enabled: true,
            only: true,
            include: ["packages/*/test/**/*.test-d.ts"],
            tsconfig: "./tsconfig.json",
          },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["packages/*/test/**/*.integration.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
