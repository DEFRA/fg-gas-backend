import { describe, expect, it } from "vitest";
import { agreementDefinitions } from "../models/agreement-definitions/agreement-definition-registry.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import {
  buildAgreementDocumentPageModel,
  buildAgreementPageModel,
} from "./build-agreement-page-model.js";

const pmfAgreementDefinition = agreementDefinitions.find(
  ({ code }) => code === "pigs-might-fly",
);

const definition = new AgreementDefinition({
  code: "test",
  configVersion: "1",
  agreementNumberPrefix: "TST",
  create: { target: "offered" },
  states: {
    offered: {
      page: "offer",
      on: {
        print: {
          target: "offered",
          validation: {
            page: "document",
            required: [
              {
                name: "confirm",
                value: "yes",
                href: "#confirm",
                message: "Confirm",
              },
            ],
          },
        },
      },
    },
  },
  pages: {
    offer: {
      title: "Offer",
      components: [{ component: "heading", text: "Agreement offer" }],
      actions: [],
    },
    document: {
      title: "Document",
      layout: "document",
      contents: true,
      print: true,
      watermark: {
        condition: "jsonata:$.agreement.state = 'offered'",
        text: "DRAFT",
      },
      components: [{ component: "heading", text: "Document" }],
      sections: [
        {
          id: "agreement-details",
          title: "Agreement $.agreement.agreementNumber",
          components: [
            {
              component: "paragraph",
              text: "SBI $.agreement.identifiers.sbi",
            },
          ],
        },
        {
          id: "accepted-only",
          title: "Acceptance",
          condition: "jsonata:$.agreement.state = 'accepted'",
          components: [{ component: "paragraph", text: "Accepted" }],
        },
      ],
      actions: [{ name: "accept", method: "GET", text: "Accept", href: "/" }],
    },
  },
});
const agreement = {
  agreementNumber: "TST123",
  code: "test",
  clientRef: "client",
  configVersion: "1",
  identifiers: {
    sbi: "300000000",
    frn: "1000000000",
    crn: "1100000000",
  },
  state: "offered",
  version: 1,
};
const offeredValues = {
  application: { whitePigsCount: 5 },
  actions: [
    {
      id: "action:1",
      code: "largeWhite",
      description: "Large White Pig",
      quantity: 5,
      unit: "head",
      ratePence: 1000,
      totalAmountPence: 5000,
    },
  ],
  items: [],
  startDate: "2026-08-06",
  endDate: "2027-08-05",
  totalAmountPence: 5000,
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:1",
        dueDate: "2026-11-11",
        totalAmountPence: 5000,
        lineItems: [{ actionId: "action:1", amountPence: 5000 }],
      },
    ],
  },
};

describe("buildAgreementPageModel", () => {
  it("builds presentation from one Agreement", async () => {
    await expect(
      buildAgreementPageModel({
        agreement,
        agreementDefinition: definition,
        page: "offer",
        mode: "view",
      }),
    ).resolves.toEqual({
      agreement: {
        agreementNumber: "TST123",
        code: "test",
        clientRef: "client",
        identifiers: { sbi: "300000000" },
        state: "offered",
        version: 1,
      },
      page: { name: "offer", title: "Offer" },
      components: [{ component: "heading", text: "Agreement offer" }],
      actions: [],
    });
  });

  it("removes actions in print mode", async () => {
    const result = await buildAgreementPageModel({
      agreement,
      agreementDefinition: definition,
      page: "document",
      mode: "print",
    });
    expect(result.page.layout).toBe("document");
    expect(result).not.toHaveProperty("sections");
    expect(result.actions).toEqual([]);
  });

  it("builds pages.document without lifecycle actions", async () => {
    const result = await buildAgreementDocumentPageModel({
      agreement,
      agreementDefinition: definition,
    });

    expect(result.page).toEqual({
      name: "document",
      title: "Document",
      layout: "document",
      contents: true,
      print: true,
      watermark: { text: "DRAFT" },
    });
    expect(result.sections).toEqual([
      {
        id: "agreement-details",
        title: "Agreement TST123",
        components: [{ component: "paragraph", text: "SBI 300000000" }],
      },
    ]);
    expect(result.actions).toEqual([]);
  });

  it("omits a conditional watermark when its condition is false", async () => {
    const result = await buildAgreementDocumentPageModel({
      agreement: { ...agreement, state: "accepted" },
      agreementDefinition: definition,
    });

    expect(result.page.watermark).toBeUndefined();
    expect(result.sections.at(-1)).toEqual({
      id: "accepted-only",
      title: "Acceptance",
      components: [{ component: "paragraph", text: "Accepted" }],
    });
  });

  it("builds accepted PMF pages from the stored offered values", async () => {
    const acceptedAgreement = {
      ...agreement,
      code: "pigs-might-fly",
      configVersion: "1.2.0",
      state: "accepted",
      acceptedAt: "2026-07-31T15:30:00.000Z",
      ...offeredValues,
    };
    const pmfDefinition = new AgreementDefinition(pmfAgreementDefinition);

    const [documentModel, acceptedModel] = await Promise.all([
      buildAgreementDocumentPageModel({
        agreement: acceptedAgreement,
        agreementDefinition: pmfDefinition,
      }),
      buildAgreementPageModel({
        agreement: acceptedAgreement,
        agreementDefinition: pmfDefinition,
        page: "accepted",
        mode: "view",
      }),
    ]);

    expect(documentModel.page.watermark).toBeUndefined();
    expect(
      documentModel.sections.find(({ id }) => id === "pigs-and-funding"),
    ).toEqual({
      id: "pigs-and-funding",
      title: "Pigs and funding",
      components: [
        {
          component: "table",
          head: [
            { text: "Pig type" },
            { text: "Number of pigs" },
            { text: "Funding amount" },
          ],
          rows: [[{ text: "Large White Pig" }, { text: 5 }, { text: "£50" }]],
        },
        {
          component: "summary-list",
          rows: [{ label: "Total funding", text: "£50" }],
        },
      ],
    });
    expect(documentModel.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "payment-schedule",
          components: expect.arrayContaining([
            expect.objectContaining({
              component: "table",
              rows: [[{ text: "11 November 2026" }, { text: "£50" }]],
            }),
          ]),
        }),
      ]),
    );
    expect(acceptedModel.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "summary-list",
          rows: expect.arrayContaining([
            { label: "Agreement start date", text: "6 August 2026" },
            { label: "Total payment", text: "£50" },
          ]),
        }),
      ]),
    );
  });

  it("separates the PMF draft agreement link from the primary action", async () => {
    const offeredAgreement = {
      ...agreement,
      code: "pigs-might-fly",
      ...offeredValues,
    };

    const model = await buildAgreementPageModel({
      agreement: offeredAgreement,
      agreementDefinition: new AgreementDefinition(pmfAgreementDefinition),
      page: "offered",
      mode: "view",
    });

    expect(
      model.components.find(({ component }) => component === "table"),
    ).toEqual({
      component: "table",
      head: [
        { text: "Pig type" },
        { text: "Number of pigs" },
        { text: "Funding amount" },
      ],
      rows: [[{ text: "Large White Pig" }, { text: 5 }, { text: "£50" }]],
    });
    expect(model.components).toContainEqual({
      component: "summary-list",
      rows: [
        { label: "Agreement start date", text: "6 August 2026" },
        { label: "Agreement end date", text: "5 August 2027" },
        { label: "Total funding", text: "£50" },
      ],
    });
    expect(model.components).toContainEqual({
      component: "table",
      head: [{ text: "Payment date" }, { text: "Amount" }],
      rows: [[{ text: "11 November 2026" }, { text: "£50" }]],
    });
    expect(model.components).toContainEqual(
      expect.objectContaining({
        component: "url",
        text: "View the draft agreement",
        classes: "govuk-link govuk-!-display-block govuk-!-margin-bottom-4",
      }),
    );
  });

  it("builds the PMF acceptance page from the same stored offered values", async () => {
    const model = await buildAgreementPageModel({
      agreement: {
        ...agreement,
        code: "pigs-might-fly",
        ...offeredValues,
      },
      agreementDefinition: new AgreementDefinition(pmfAgreementDefinition),
      page: "accept",
      mode: "view",
    });

    expect(model.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "summary-list",
          rows: expect.arrayContaining([
            { label: "Agreement start date", text: "6 August 2026" },
            { label: "Total funding", text: "£50" },
          ]),
        }),
        {
          component: "table",
          head: [{ text: "Payment date" }, { text: "Amount" }],
          rows: [[{ text: "11 November 2026" }, { text: "£50" }]],
        },
      ]),
    );
  });

  it("resolves a template from the definition against the agreement", async () => {
    const templateDefinition = new AgreementDefinition({
      code: "test",
      configVersion: "1",
      agreementNumberPrefix: "TST",
      create: { target: "offered" },
      states: { offered: { page: "offer" } },
      templates: {
        stateSummary: {
          offered: {
            content: [{ component: "status", text: "Draft agreement" }],
          },
        },
      },
      pages: {
        offer: {
          title: "Offer",
          components: [
            {
              component: "template",
              templateRef: "$.definition.templates.stateSummary",
              templateKey: "$.agreement.state",
            },
          ],
          actions: [],
        },
      },
    });

    await expect(
      buildAgreementPageModel({
        agreement,
        agreementDefinition: templateDefinition,
        page: "offer",
        mode: "view",
      }),
    ).resolves.toMatchObject({
      components: [{ component: "status", text: "Draft agreement" }],
    });
  });

  it("returns a controlled internal error, naming the page and agreement but not agreement data, when a valid definition cannot be resolved", async () => {
    const unresolvableDefinition = new AgreementDefinition({
      code: "test",
      configVersion: "1",
      agreementNumberPrefix: "TST",
      create: { target: "offered" },
      states: { offered: { page: "offer" } },
      pages: {
        offer: {
          title: "Offer",
          components: [
            { component: "paragraph", text: "$.agreement.doesNotExist" },
          ],
          actions: [],
        },
      },
    });

    const error = await buildAgreementPageModel({
      agreement,
      agreementDefinition: unresolvableDefinition,
      page: "offer",
      mode: "view",
    }).catch((thrown) => thrown);

    expect(error.isBoom).toBe(true);
    expect(error.output.statusCode).toBe(500);
    expect(error.message).toBe(
      'Unable to build page model "offer" for agreement "TST123"',
    );
    expect(error.message).not.toContain(agreement.identifiers.sbi);
  });
});
