import { readFileSync } from "node:fs";

const definition = JSON.parse(
  readFileSync(new URL("./pmf-agreement-definition.json", import.meta.url)),
);

const explicitTree = (components) => [
  {
    component: "grid-row",
    components: [{ component: "grid-column", width: "two-thirds", components }],
  },
];

for (const page of Object.values(definition.pages)) {
  page.components = explicitTree(page.components);

  for (const section of page.sections ?? []) {
    section.components = explicitTree(section.components);
  }
}

export const pmfAgreementDefinitionFixture = definition;
