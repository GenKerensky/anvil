import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  prettierConfig,
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
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["test/**/*.{js,ts}"],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        vi: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: ["node_modules/**", "temp/**", "locale/**", "test/__mocks__/**"],
  },
];
