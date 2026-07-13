import eslintConfigPrettier from "eslint-config-prettier/flat";
import importX from "eslint-plugin-import-x";
import neostandard from "neostandard";

export default [
  ...neostandard({
    env: ["node"],
  }),
  eslintConfigPrettier,
  {
    files: ["src/**/*"],
    plugins: {
      "import-x": importX,
    },
    rules: {
      "func-style": ["error", "expression"],
      "no-console": "error",
      complexity: ["error", { max: 4 }],
      "import-x/extensions": ["error", { js: "always", json: "always" }],
      "import-x/no-unresolved": "error",
      "import-x/named": "error",
      "import-x/default": "error",
      "import-x/export": "error",
      "import-x/no-default-export": "error",
      "import-x/no-mutable-exports": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-useless-path-segments": "error",
      "import-x/no-cycle": "error",
      "import-x/no-extraneous-dependencies": [
        "error",
        { devDependencies: ["src/**/*.test.js", "test/**"] },
      ],
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
              except: [
                "**/use-cases/**",
                "**/services/**",
                "**/schemas/**",
                "**/common/logger.js",
              ],
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
                "**/common/**",
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
                "**/common/**",
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
              except: ["**/common/**", "**/events/**", "**/commands/**"],
              message: "Publishers should only import common and events",
            },
            {
              target: "**/services/**/!(*.test).js",
              from: ["src/**/**"],
              except: [
                "**/events/**",
                "**/common/**",
                "**/repositories/**",
                "**/publishers/**",
                "**/services/**",
                "**/use-cases/**",
              ],
              message:
                "Services should only import repositories, use-cases, events, publishers and common",
            },
            {
              target: "**/agreements/**/!(*.test).js",
              from: ["**/grants/**"],
              message:
                "Agreements must not import Grants or Application domain internals directly. " +
                "Use HTTP APIs, events, commands, or inbox/outbox records as integration seams. " +
                "See docs/MODULE_BOUNDARIES.md.",
            },
            {
              target: "**/grants/**/!(*.test).js",
              from: ["**/agreements/**"],
              message:
                "Grants must not import Agreements domain internals directly. " +
                "Use HTTP APIs, events, commands, or inbox/outbox records as integration seams. " +
                "See docs/MODULE_BOUNDARIES.md.",
            },
          ],
        },
      ],
    },
  },
];
