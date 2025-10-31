import eslintConfigPrettier from "eslint-config-prettier/flat";
import neostandard from "neostandard";

// Minimal workaround for CI rspack-resolver native binding issues
process.env.DISABLE_NATIVE_RESOLVE = "true";

export default [
  {
    ignores: ["test/reports/**", "coverage/**"],
  },
  ...neostandard({
    env: ["node"],
  }),
  eslintConfigPrettier,
  {
    files: ["src/**/*"],
    rules: {
      "func-style": ["error", "expression"],
      "no-console": "error",
      complexity: ["error", { max: 4 }],
      // Disable import-x rules that cause rspack-resolver native binding issues in CI
      "import-x/extensions": "off",
      "import-x/no-unresolved": "off",
      "import-x/named": "off",
      "import-x/default": "off",
      "import-x/export": "off",
      "import-x/no-default-export": "error",
      "import-x/no-mutable-exports": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-useless-path-segments": "error",
      "import-x/no-cycle": "off", // Also uses resolver
      "import-x/no-extraneous-dependencies": "off", // Also uses resolver
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
                "**/services/**",
              ],
              message:
                "Use cases should only import services, commands, repositories, models, events, publishers and common",
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
