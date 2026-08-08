import { describe, expect, it } from "vitest";
import { AgreementDefinition } from "./agreement-definition.js";

const createDefinition = (values) =>
  new AgreementDefinition({
    code: "woodland",
    configVersion: "1.0.0",
    agreementNumberPrefix: "WMP",
    create: {
      target: "offered",
      application: "$.input.answers",
      values,
      processes: [],
    },
    states: { offered: { page: "offered" } },
    pages: {
      offered: {
        title: "Offer",
        components: [{ component: "heading", text: "Offer" }],
      },
    },
  });

const input = {
  scheme: "WMP",
  answers: {
    woodlandName: "Oakridge Estate",
    applicant: {
      business: {
        name: "Oakridge Estate",
        address: { line1: "Farm House", postalCode: "YO1 1AA" },
      },
      customer: { name: { first: "Alex", last: "Farmer" } },
    },
    landParcels: [
      {
        id: "SK0971-7555",
        sheetId: "SK0971",
        parcelId: "7555",
        areaHa: 5.2182,
      },
    ],
    payments: {
      agreement: [
        {
          code: "WMP1",
          description: "Produce a woodland management plan",
          quantity: 15.75,
          unit: "ha",
          agreementTotalPence: 157500,
        },
      ],
    },
    totalAgreementPaymentPence: 157500,
  },
};

const creationValues = {
  schemeCode: "$.input.scheme",
  name: "jsonata:$.application.woodlandName & ' WMP'",
  applicant: "$.application.applicant",
  parcels: {
    itemsRef: "$.application.landParcels",
    items: {
      id: "@.id",
      sheetId: "@.sheetId",
      parcelId: "@.parcelId",
      area: { quantity: "@.areaHa", unit: "ha" },
    },
  },
  actions: [],
  items: {
    itemsRef: "$.application.payments.agreement",
    items: {
      ref: "@.code",
      code: "@.code",
      description: "@.description",
      quantity: "@.quantity",
      unit: "@.unit",
      totalAmountPence: "@.agreementTotalPence",
    },
  },
  totalAmountPence: "$.application.totalAgreementPaymentPence",
};

describe("AgreementDefinition creation-value mapping", () => {
  it("maps supplied input and Application into typed Agreement value candidates", async () => {
    const definition = createDefinition(creationValues);
    const application = await definition.resolveApplication(input);

    await expect(
      definition.resolveCreationValues({ input, application }),
    ).resolves.toEqual({
      schemeCode: "WMP",
      name: "Oakridge Estate WMP",
      applicant: input.answers.applicant,
      parcels: [
        {
          id: "SK0971-7555",
          sheetId: "SK0971",
          parcelId: "7555",
          area: { quantity: 5.2182, unit: "ha" },
        },
      ],
      actions: [],
      items: [
        {
          ref: "WMP1",
          code: "WMP1",
          description: "Produce a woodland management plan",
          quantity: 15.75,
          unit: "ha",
          totalAmountPence: 157500,
        },
      ],
      totalAmountPence: 157500,
    });
  });

  it("isolates Creation Input, Application and resolved values", async () => {
    const mutableInput = structuredClone(input);
    const definition = createDefinition(creationValues);
    const application = await definition.resolveApplication(mutableInput);
    const first = await definition.resolveCreationValues({
      input: mutableInput,
      application,
    });

    mutableInput.scheme = "CHANGED";
    application.woodlandName = "Changed woodland";
    first.applicant.business.name = "Changed business";

    const secondApplication = await definition.resolveApplication(input);
    await expect(
      definition.resolveCreationValues({
        input,
        application: secondApplication,
      }),
    ).resolves.toMatchObject({
      schemeCode: "WMP",
      name: "Oakridge Estate WMP",
      applicant: { business: { name: "Oakridge Estate" } },
    });
  });

  it("redacts unresolved creation-value mappings", async () => {
    const values = structuredClone(creationValues);
    values.name = "$.application.secretAgreementName";
    const definition = createDefinition(values);
    const application = await definition.resolveApplication(input);

    await expect(
      definition.resolveCreationValues({
        input: { ...input, sensitiveReference: "SENSITIVE" },
        application,
      }),
    ).rejects.toMatchObject({
      message:
        'Agreement definition "woodland" could not resolve creation values',
      output: { statusCode: 500 },
    });
  });

  it("rejects malformed resolved values without exposing source data", async () => {
    const values = structuredClone(creationValues);
    values.totalAmountPence = "$.input.sensitiveTotal";
    const definition = createDefinition(values);
    const application = await definition.resolveApplication(input);

    await expect(
      definition.resolveCreationValues({
        input: { ...input, sensitiveTotal: "157500-secret" },
        application,
      }),
    ).rejects.toMatchObject({
      message:
        'Agreement definition "woodland" produced invalid creation value "totalAmountPence" at: value',
      output: { statusCode: 500 },
    });
  });

  it("rejects invalid mapping syntax when compiling the Definition", () => {
    const values = structuredClone(creationValues);
    values.name = "jsonata:sensitive-configuration + (";

    expect(() => createDefinition(values)).toThrow(
      '"create.values" contains an invalid mapping',
    );
  });

  it("rejects unsupported top-level Agreement values", () => {
    expect(() =>
      createDefinition({
        actions: [],
        items: [],
        supplementaryData: { legacy: true },
      }),
    ).toThrow(
      '"create.values.supplementaryData" is not a supported Agreement value',
    );
  });

  it("rejects a field produced by both creation mapping and a Process", () => {
    expect(
      () =>
        new AgreementDefinition({
          code: "woodland",
          configVersion: "1.0.0",
          agreementNumberPrefix: "WMP",
          processDefinitions: {
            CALCULATE_TOTAL: {
              type: "endpoint",
              endpoint: {
                method: "POST",
                path: "/calculate",
                service: "LAND_GRANTS",
              },
              request: { body: {} },
              output: { totalAmountPence: "$.response.totalAmountPence" },
            },
          },
          create: {
            target: "offered",
            application: "$.input.answers",
            values: {
              actions: [],
              items: [],
              totalAmountPence: 157500,
            },
            processes: ["CALCULATE_TOTAL"],
          },
          states: { offered: { page: "offered" } },
          pages: {
            offered: {
              title: "Offer",
              components: [{ component: "heading", text: "Offer" }],
            },
          },
        }),
    ).toThrow(
      'sequence "create.processes" output "totalAmountPence" has competing producers',
    );
  });

  it("rejects unknown nested Agreement fields when compiling the Definition", () => {
    const values = structuredClone(creationValues);
    values.items.items.itemCode = "@.code";

    expect(() => createDefinition(values)).toThrow(
      'create.values.items.itemCode" is unknown',
    );
  });
});
