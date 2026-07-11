import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import vitest from "@vitest/eslint-plugin";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "locale/**",
      "test/unit/__mocks__/**",
      "test/e2e/.venv/**",
    ],
  },
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
      // GJS/Meta interop still needs any in places; prefer unknown for new public APIs.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["test/unit/**/*.{js,ts}"],
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
  {
    files: ["test/e2e/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        fdescribe: "readonly",
        xdescribe: "readonly",
        it: "readonly",
        fit: "readonly",
        xit: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        pending: "readonly",
        spyOn: "readonly",
        spyOnProperty: "readonly",
        jasmine: "readonly",
      },
    },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fit", message: "Focused jasmine test (fit) — remove before committing" },
        {
          name: "fdescribe",
          message: "Focused jasmine suite (fdescribe) — remove before committing",
        },
      ],
    },
  },
];
