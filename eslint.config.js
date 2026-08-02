// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "playwright-report", "test-results", "node_modules"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    // Context/provider modules intentionally export hooks alongside a component.
    files: ["src/app/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["server/**/*.ts", "*.config.{ts,js}", "e2e/**/*.ts", "scripts/**/*.{ts,mjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Scripts that drive a browser hold two environments in one file: Node
    // around the outside, and page.evaluate bodies that run in Chromium and
    // legitimately reach for OffscreenCanvas and friends.
    files: ["scripts/**/*.{ts,mjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
