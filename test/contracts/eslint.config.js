import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";

// Separate ESLint config for contract tests to avoid rspack-resolver issues
export default [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off", // Contract tests may have unused test setup variables
      "no-console": "off", // Allow console statements for contract test debugging
      "prefer-const": "off", // Relaxed rules for test files
    },
  },
];
