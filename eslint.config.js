import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default [
  {
    ignores: ["test/reports/**", "coverage/**"],
  },
  js.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        exports: "readonly",
        module: "readonly",
        require: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        URLSearchParams: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      "no-console": "error",
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: "error",
      "no-unused-vars": "error",
    },
  },
  {
    files: ["src/**/*"],
    rules: {
      "func-style": ["error", "expression"],
      complexity: ["error", { max: 4 }],
    },
  },
  {
    files: ["test/**/*", "**/*.test.js", "scripts/**/*", "migrations/**/*"],
    rules: {
      "no-console": "off", // Allow console in tests, scripts, and migrations
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }], // Allow unused vars with _ prefix
    },
  },
];
