import neostandard from "neostandard";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default [
  ...neostandard({
    env: ["node"],
  }),
  eslintConfigPrettier,
  {
    files: ["src/**/*"],
    rules: {
      "import-x/no-cycle": [
        "error",
        {
          maxDepth: 1,
        },
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
                "**/repositories/**",
              ],
              message:
                "Models should not import routes, subscribers, use cases or repositories",
            },
            {
              target: "**/repositories/**/!(*.test).js",
              from: ["**/routes/**", "**/subscribers/**", "**/use-cases/**"],
              message:
                "Respositories should not import routes, subscribers, use cases or models",
            },
            {
              target: "**/routes/**/!(*.test).js",
              from: ["./src/**/**"],
              except: ["**/use-cases/**", "**/schemas/**"],
              message: "Routes should only import use cases and schemas",
            },
            {
              target: "**/subscribers/**/!(*.test).js",
              from: ["./src/**/**"],
              except: ["**/use-cases/**", "**/schemas/**"],
              message: "Subscribers should only import use cases and schemas",
            },
            {
              target: "**/use-cases/**/!(*.test).js",
              from: ["./src/**/**"],
              except: [
                "**/repositories/**",
                "**/models/**",
                "**/publishers/**",
                "src/common/**",
              ],
              message:
                "Use cases should only import repositories, models, publishers and common",
            },
            {
              target: "**/publishers/**/!(*.test).js",
              from: ["./src/**/**"],
              except: ["src/common/**"],
              message: "Publishers should only import common",
            },
          ],
        },
      ],
    },
  },
];
