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

const placeActions = (components, actions = []) => {
  if (actions.length === 0) {
    return explicitTree(components);
  }

  const [action] = actions;
  const button = { component: "button", actionId: action.name };

  return explicitTree(
    action.method === "POST"
      ? [
          {
            component: "form",
            actionId: action.name,
            components: [...components, button],
          },
        ]
      : [...components, button],
  );
};

for (const page of Object.values(definition.pages)) {
  page.components = placeActions(page.components, page.actions);

  for (const section of page.sections ?? []) {
    section.components = explicitTree(section.components);
  }
}

export const pmfAgreementDefinitionFixture = definition;
