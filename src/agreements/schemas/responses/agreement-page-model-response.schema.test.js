import { describe, expect, it } from "vitest";
import { agreementPageModelResponseSchema } from "./agreement-page-model-response.schema.js";
import { invokeAgreementActionResponseSchema } from "./invoke-agreement-action-response.schema.js";

const agreement = {
  agreementNumber: "TST123",
  code: "test",
  clientRef: "client",
  identifiers: { sbi: "300000000" },
  state: "offered",
  version: 1,
};
const components = [
  {
    component: "grid-row",
    components: [
      {
        component: "grid-column",
        width: "two-thirds",
        components: [
          {
            component: "form",
            method: "POST",
            formAction: "/agreements/TST123/actions/accept",
            hiddenFields: [],
            components: [
              { component: "checkboxes", name: "confirm", items: [] },
              { component: "button", text: "Accept", submit: true },
            ],
          },
        ],
      },
    ],
  },
];
const pageModel = {
  agreement,
  page: { name: "accept", title: "Accept" },
  components,
};

const errors = (schema, value) =>
  schema
    .validate(value, { abortEarly: false })
    .error?.details.map(({ message }) => message) ?? [];

describe("agreementPageModelResponseSchema", () => {
  it("accepts one resolved component tree", () => {
    expect(errors(agreementPageModelResponseSchema, pageModel)).toEqual([]);
  });

  it.each([
    ["the actions catalogue", { ...pageModel, actions: [] }],
    [
      "a flat component list",
      {
        ...pageModel,
        components: [{ component: "paragraph", text: "No grid" }],
      },
    ],
    [
      "an unsupported width",
      {
        ...pageModel,
        components: [
          {
            ...components[0],
            components: [{ ...components[0].components[0], width: "quarter" }],
          },
        ],
      },
    ],
  ])("rejects %s", (_name, value) => {
    expect(errors(agreementPageModelResponseSchema, value)).not.toEqual([]);
  });
});

describe("invokeAgreementActionResponseSchema", () => {
  it("accepts validation state composed with the resolved form tree", () => {
    expect(
      errors(invokeAgreementActionResponseSchema, {
        ...pageModel,
        values: {},
        errors: [{ href: "#confirm", text: "Confirm acceptance" }],
      }),
    ).toEqual([]);
  });

  it("rejects the removed split validation model", () => {
    expect(
      errors(invokeAgreementActionResponseSchema, {
        ...pageModel,
        actions: [],
        values: {},
        errors: [{ href: "#confirm", text: "Confirm acceptance" }],
      }),
    ).not.toEqual([]);
  });
});
