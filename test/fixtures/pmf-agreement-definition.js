import { readFileSync } from "node:fs";

export const pmfAgreementDefinitionFixture = JSON.parse(
  readFileSync(new URL("./pmf-agreement-definition.json", import.meta.url)),
);
