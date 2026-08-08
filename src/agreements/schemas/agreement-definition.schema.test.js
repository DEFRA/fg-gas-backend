import { describe, expect, it } from "vitest";
import { agreementDefinitions } from "../models/agreement-definitions/agreement-definition-registry.js";
import { agreementDefinitionSchema } from "./agreement-definition.schema.js";

const pmfAgreementDefinition = agreementDefinitions.find(
  ({ code }) => code === "pigs-might-fly",
);

const validate = (definition) =>
  agreementDefinitionSchema.validate(definition, { abortEarly: false });

describe("agreementDefinitionSchema", () => {
  it("validates a complete agreement definition", () => {
    const { error } = validate(pmfAgreementDefinition);

    expect(error).toBeUndefined();
  });

  it("fails when top-level required fields are missing", () => {
    const { error } = validate({});

    expect(error).toBeDefined();
    const messages = error.details.map((d) => d.message).join(", ");
    expect(messages).toMatch(/"code" is required/);
    expect(messages).toMatch(/"configVersion" is required/);
    expect(messages).toMatch(/"agreementNumberPrefix" is required/);
    expect(messages).toMatch(/"Create" is required/);
    expect(messages).toMatch(/"States" is required/);
    expect(messages).toMatch(/"Pages" is required/);
  });

  it("fails when create.target is missing", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.create.target;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"create.target" is required/,
    );
  });

  it("fails when a lifecycle action is missing its target", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.states.offered.on.accept.target;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"states.offered.on.accept.target" is required/,
    );
  });

  it("fails when validation.required is empty", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states.offered.on.accept.validation.required = [];

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /must contain at least 1 items/,
    );
  });

  it("fails when a page is missing its title", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.pages.offered.title;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"pages.offered.title" is required/,
    );
  });

  it("fails when a page component is missing its component name", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.pages.offered.components[0].component;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"pages.offered.components\[0\].component" is required/,
    );
  });

  it("validates document sections, contents, print and watermark", () => {
    const definition = structuredClone(pmfAgreementDefinition);

    const { error } = validate(definition);

    expect(error).toBeUndefined();
    expect(definition.pages.document.contents).toBe(true);
    expect(definition.pages.document.print).toBe(true);
    expect(definition.pages.document.sections.length).toBeGreaterThan(0);
  });

  it("fails when watermark configuration contains UI classes", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.pages.document.watermark.classes = "custom-watermark";

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((detail) => detail.message).join(", ")).toMatch(
      /"pages.document.watermark.classes" is not allowed/,
    );
  });

  it("rejects Processes on the read-only document page", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.pages.document.processes = ["GENERATE_OFFER"];

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((detail) => detail.message).join(", ")).toMatch(
      /"pages.document.processes" is not allowed/,
    );
  });

  it("fails when document section ids are duplicated", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.pages.document.sections[1].id =
      definition.pages.document.sections[0].id;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((detail) => detail.message).join(", ")).toMatch(
      /contains a duplicate value/,
    );
  });

  it("fails when a document section id cannot be used as an HTML anchor", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.pages.document.sections[0].id = "Payment schedule";

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((detail) => detail.message).join(", ")).toMatch(
      /fails to match the required pattern/,
    );
  });

  it("fails when states has no entries", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states = {};

    const { error } = validate(definition);

    expect(error).toBeDefined();
  });

  it("rejects obsolete Effects", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states.offered.on.accept.effects = [{ name: "publish" }];

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((detail) => detail.message).join(", ")).toMatch(
      /"states.offered.on.accept.effects" is not allowed/,
    );
  });

  it("allows extra keys on validation and action transitions, so other agreement types can extend them", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states.offered.on.accept.validation.hint = "extra guidance";
    definition.states.offered.on.accept.description = "Accept the offer";

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });

  it("allows extra keys on required-validation-field, page action and page, so other agreement types can extend them", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states.offered.on.accept.validation.required[0].hint =
      "extra guidance";
    definition.pages.offered.actions[0].style = "secondary";
    definition.pages.offered.extraPageMetadata = "allowed";

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });

  it("fails when an endpoint is missing a required field", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.endpoints = [
      { code: "calculate", method: "POST", path: "/calculate" },
    ];

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"endpoints\[0\].service" is required/,
    );
  });

  it("validates without an endpoints array, since it's optional", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.endpoints;

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });
});

describe("agreementDefinitionSchema resolver instructions", () => {
  const withComponents = (components, templates) => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.pages.offered.components = components;

    if (templates) {
      definition.templates = templates;
    }

    return definition;
  };

  const messagesFor = (definition) => {
    const { error } = validate(definition);

    expect(error).toBeDefined();

    return error.details.map((detail) => detail.message).join(", ");
  };

  it("validates conditional, repeat, template and container entries, including nested ones", () => {
    const definition = withComponents(
      [
        {
          component: "notification-banner",
          condition: "jsonata:$.agreement.state = 'offered'",
          title: "Draft agreement",
        },
        {
          component: "conditional",
          condition: "jsonata:$.agreement.state = 'accepted'",
          whenTrue: { component: "status", text: "Accepted" },
          whenFalse: { component: "status", text: "Draft" },
        },
        {
          component: "repeat",
          itemsRef: "$.agreement.parcels",
          beforeContent: [{ component: "heading", level: 2, text: "Parcels" }],
          items: [
            {
              component: "component-container",
              content: [{ component: "paragraph", text: "Parcel @.sheetId" }],
            },
          ],
          emptyContent: [{ component: "paragraph", text: "None" }],
        },
        {
          component: "template",
          templateRef: "$.definition.templates.paymentSummary",
          templateKey: "$.agreement.paymentScheme",
          dataRef: "$.agreement.paymentSchedule",
        },
      ],
      {
        paymentSummary: {
          annual: { content: [{ component: "paragraph", text: "Annual" }] },
        },
      },
    );

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });

  it.each([
    [
      "a repeat with no items",
      [{ component: "repeat", itemsRef: "$.agreement.parcels" }],
      /"pages\.offered\.components\[0\]\.items" is required/,
    ],
    [
      "a repeat whose itemsRef is not a reference string",
      [
        {
          component: "repeat",
          itemsRef: 5,
          items: [{ component: "paragraph", text: "x" }],
        },
      ],
      /"pages\.offered\.components\[0\]\.itemsRef" must be a string/,
    ],
    [
      "a conditional with no branches",
      [{ component: "conditional", condition: "jsonata:$.agreement.state" }],
      /"pages\.offered\.components\[0\]" must contain at least one of \[whenTrue, whenFalse\]/,
    ],
    [
      "a conditional with no condition",
      [{ component: "conditional", whenTrue: { component: "status" } }],
      /"pages\.offered\.components\[0\]\.condition" is required/,
    ],
    [
      "a template with no templateKey",
      [{ component: "template", templateRef: "$.definition.templates.x" }],
      /"pages\.offered\.components\[0\]\.templateKey" is required/,
    ],
    [
      "a container with no content",
      [{ component: "component-container" }],
      /"pages\.offered\.components\[0\]\.content" is required/,
    ],
    [
      "a table with no rowsRef",
      [{ component: "table", rows: [{ text: "@.description" }] }],
      /"pages\.offered\.components\[0\]\.rowsRef" is required/,
    ],
    [
      "a url with an incomplete structured href",
      [
        {
          component: "url",
          href: { params: { agreementNumber: "$.agreement.agreementNumber" } },
          text: "View agreement",
        },
      ],
      /"pages\.offered\.components\[0\]\.href\.urlTemplate" is required/,
    ],
  ])("fails, identifying the entry, for %s", (_name, components, expected) => {
    expect(messagesFor(withComponents(components))).toMatch(expected);
  });

  // A condition is a string either way, so without this a typo would validate
  // and then quietly evaluate to false, removing content from the page.
  it("fails when a condition is not a reference or a jsonata: expression", () => {
    const components = [
      { component: "notification-banner", condition: "alwyas", title: "Draft" },
    ];

    expect(messagesFor(withComponents(components))).toMatch(
      /"pages\.offered\.components\[0\]\.condition" with value "alwyas" fails to match the reference or jsonata: expression pattern/,
    );
  });

  // Without the prefix this would interpolate to the text "2 * 3" instead of
  // calculating, so it is caught at definition time rather than on the page.
  it("fails when an expression over several references omits the jsonata: prefix", () => {
    const components = [
      {
        component: "notification-banner",
        condition: "$.price * $.quantity",
        title: "Draft",
      },
    ];

    expect(messagesFor(withComponents(components))).toMatch(
      /"pages\.offered\.components\[0\]\.condition" with value "\$\.price \* \$\.quantity" fails to match the reference or jsonata: expression pattern/,
    );
  });

  it("fails when a data reference is not a reference", () => {
    const components = [
      {
        component: "repeat",
        itemsRef: "parcels",
        items: [{ component: "paragraph", text: "x" }],
      },
    ];

    expect(messagesFor(withComponents(components))).toMatch(
      /"pages\.offered\.components\[0\]\.itemsRef".*fails to match/,
    );
  });

  it("accepts a conditional branch holding several components", () => {
    const definition = withComponents([
      {
        component: "conditional",
        condition: "jsonata:$.agreement.state = 'accepted'",
        whenTrue: [
          { component: "heading", level: 2, text: "Accepted" },
          { component: "paragraph", text: "Done" },
        ],
      },
    ]);

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });

  it("identifies a malformed entry nested inside another instruction", () => {
    const components = [
      {
        component: "repeat",
        itemsRef: "$.agreement.parcels",
        items: [{ component: "component-container" }],
      },
    ];

    expect(messagesFor(withComponents(components))).toMatch(
      /"pages\.offered\.components\[0\]\.items\[0\]\.content" is required/,
    );
  });

  it("fails when a template's content is malformed", () => {
    const definition = withComponents([{ component: "paragraph", text: "x" }], {
      paymentSummary: { annual: { content: "not-an-array" } },
    });

    expect(messagesFor(definition)).toMatch(
      /"templates\.paymentSummary\.annual\.content" must be an array/,
    );
  });
});
