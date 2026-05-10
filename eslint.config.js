import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import vitest from "@vitest/eslint-plugin";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["node_modules/**", "dist/**", "locale/**", "test/__mocks__/**"] },

  js.configs.recommended,
  prettierConfig,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        global: "readonly",
        imports: "readonly",
        log: "readonly",
        logError: "readonly",
        print: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  {
    files: ["test/**/*.{js,ts}"],
    plugins: { vitest },
    languageOptions: {
      globals: vitest.environments.env.globals,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "vitest/no-disabled-tests": "warn",
      "vitest/no-focused-tests": "error",
    },
  },

  // Files with @ts-nocheck (GObject property patterns — strict mode TODO)
  {
    files: [
      "lib/extension/window.ts",
      "lib/extension/tree.ts",
      "lib/extension/keybindings.ts",
      "lib/extension/indicator.ts",
      "lib/shared/theme.ts",
      "lib/prefs/floating.ts",
      "lib/extension/extension-theme-manager.ts",
    ],
    rules: {
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-nocheck": false }],
    },
  },

  // Third-party CSS parser
  {
    files: ["lib/css/index.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "no-var": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
