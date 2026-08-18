import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import pluginQuery from "@tanstack/eslint-plugin-query";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,
  ...pluginQuery.configs["flat/recommended"],

  /**
   * Accessibility beyond the Next preset. The jsx-a11y plugin is already
   * registered by eslint-config-next, so these are enabled by name — importing
   * the plugin's own flat config a second time is a redefinition error.
   *
   * Accessibility is non-negotiable on a financial tool, so these are errors
   * rather than warnings.
   */
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/control-has-associated-label": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/media-has-caption": "error",
    },
  },

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // A money UI must not silently coerce. `"0.1" + 0.2` is a defect.
      "@typescript-eslint/restrict-plus-operands": "error",
      "@typescript-eslint/no-unnecessary-condition": "warn",

      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  /**
   * Architectural boundary: src/lib/api is the only place `fetch` is called.
   * This is what keeps acceptance criteria 12-14 structurally true instead of
   * being a review convention that erodes.
   */
  {
    files: [
      "app/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/features/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Network access belongs in src/lib/api only. Consume a typed hook from src/lib/query instead.",
        },
      ],
    },
  },

  /**
   * Mock fixtures must never be imported by application code. Only the mock
   * client may reach them, so a production build tree-shakes them away
   * (acceptance criterion 14).
   */
  {
    files: [
      "app/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/features/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/api/mock/**", "@/lib/api/mock/*"],
              message:
                "Mock data is not importable by application code. Select the mock client via NEXT_PUBLIC_BRIDGE_API_MODE.",
            },
          ],
        },
      ],
    },
  },

  /**
   * Wallet containment.
   *
   * Wallet-adapter and web3.js types may not escape `src/lib/solana`. Everything
   * above that boundary uses our own interfaces from `@/lib/solana`, which is
   * what makes a future migration to Solana Kit a rewrite of one directory
   * rather than of every component that shows a balance or an address.
   */
  {
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    ignores: ["src/lib/solana/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/api/mock/**", "@/lib/api/mock/*"],
              message:
                "Mock data is not importable by application code. Select the mock client via NEXT_PUBLIC_BRIDGE_API_MODE.",
            },
            {
              group: [
                "@solana/wallet-adapter-*",
                "@solana/web3.js",
                "@solana/spl-token",
                "@solana-mobile/*",
              ],
              message:
                "Wallet and chain libraries are confined to src/lib/solana. Import our own types and hooks from @/lib/solana instead.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["scripts/**/*.mjs", "*.config.{ts,mjs}", "tests/**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
    },
  },
);
