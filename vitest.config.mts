import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // tsconfig sets jsx: "preserve" for Next's compiler, so the test transform
  // (Oxc, as of Vite 8) needs the automatic runtime stated explicitly.
  oxc: { jsx: { runtime: "automatic" } },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: [
        // Fixtures are development data; they are asserted against the real
        // schemas in schemas.test.ts rather than covered as source.
        "src/lib/api/mock/**",
        "src/lib/api/index.ts",
      ],
      // Money-critical logic lives in src/lib. This floor rises as the
      // validation and timeline-mapping modules land in later PRs.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
