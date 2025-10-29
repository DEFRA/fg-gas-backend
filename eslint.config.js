import eslintConfigPrettier from "eslint-config-prettier/flat";

// Mock rspack-resolver to avoid native binding issues
try {
  // Try to mock the problematic module before neostandard loads it
  const Module = require("module");
  const originalRequire = Module.prototype.require;

  Module.prototype.require = function (id) {
    if (id === "rspack-resolver") {
      // Return a minimal mock that won't cause native binding errors
      return {
        resolve: () => ({ path: "" }),
        resolveSync: () => ({ path: "" }),
      };
    }
    return originalRequire.apply(this, arguments);
  };
} catch (err) {
  // If mocking fails, continue anyway
}

// Disable native modules for CI environments to avoid rspack-resolver issues
process.env.DISABLE_NATIVE_RESOLVE = "true";

const neostandard = await import("neostandard").then((m) => m.default);

export default [
  {
    ignores: ["test/reports/**", "coverage/**", "node_modules/**", "dist/**"],
  },
  ...neostandard({
    env: ["node"],
  }),
  eslintConfigPrettier,
  {
    // Disable import-x resolver rules that cause rspack-resolver issues
    settings: {
      "import-x/resolver": {
        node: {
          extensions: [".js", ".json"],
        },
      },
    },
  },
  {
    files: ["src/**/*"],
    rules: {
      "func-style": ["error", "expression"],
      "no-console": "error",
      complexity: ["error", { max: 4 }],
      // Disable import-x rules that use rspack-resolver to avoid native binding issues
      "import-x/extensions": "off",
      "import-x/no-unresolved": "off",
      "import-x/named": "off",
      "import-x/default": "off",
      "import-x/export": "off",
      "import-x/no-default-export": "error",
      "import-x/no-mutable-exports": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-useless-path-segments": "error",
      "import-x/no-cycle": "off", // This might also use resolver
      "import-x/no-extraneous-dependencies": "off", // This might also use resolver
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "**/models/**/!(*.test).js",
              from: [
                "**/routes/**",
                "**/subscribers/**",
                "**/use-cases/**",
                "**/services/**",
                "**/repositories/**",
              ],
              message:
                "Models should not import routes, subscribers, use cases, services or repositories",
            },
            {
              target: "**/repositories/**/!(*.test).js",
              from: [
                "**/routes/**",
                "**/subscribers/**",
                "**/use-cases/**",
                "**/services/**",
              ],
              message:
                "Respositories should not import routes, subscribers, use cases, services or models",
            },
            {
              target: "**/routes/**/!(*.test).js",
              from: ["src/**/**"],
              except: ["**/use-cases/**", "**/services/**", "**/schemas/**"],
              message:
                "Routes should only import use cases, services and schemas",
            },
            {
              target: "**/subscribers/**/!(*.test).js",
              from: ["src/**/**"],
              except: [
                "**/use-cases/**",
                "**/services/**",
                "**/schemas/**",
                "src/common/**",
                "**/repositories/**",
              ],
              message:
                "Subscribers should only import use cases, services and schemas",
            },
            {
              target: "**/use-cases/**/!(*.test).js",
              from: ["src/**/**"],
              except: [
                "**/events/**",
                "src/common/**",
                "**/repositories/**",
                "**/models/**",
                "**/use-cases/**",
                "**/commands/**",
              ],
              message:
                "Use cases should only import commands, repositories, models, events, publishers and common",
            },
            {
              target: "**/publishers/**/!(*.test).js",
              from: ["src/**/**"],
              except: ["src/common/**", "**/events/**", "**/commands/**"],
              message: "Publishers should only import common and events",
            },
            {
              target: "**/services/**/!(*.test).js",
              from: ["src/**/**"],
              except: [
                "**/events/**",
                "src/common/**",
                "**/repositories/**",
                "**/models/**",
                "**/publishers/**",
                "**/services/**",
              ],
              message:
                "Services should only import repositories, models, events, publishers and common",
            },
          ],
        },
      ],
    },
  },
];
