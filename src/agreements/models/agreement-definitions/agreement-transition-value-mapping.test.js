import Joi from "joi";
import { describe, expect, it, vi } from "vitest";
import { AgreementDefinition } from "./agreement-definition.js";

const currentAgreement = {
  agreementNumber: "TST123456789",
  version: 1,
  code: "test-transition",
  configVersion: "1.0.0",
  clientRef: "client-ref",
  correlationId: "correlation-id",
  identifiers: { sbi: "200000001" },
  schemeCode: "TEST",
  name: "Configured transition test",
  applicant: {
    business: {
      name: "High Fell Farm",
      address: { line1: "1 Moorfield", postalCode: "SK13 5CB" },
    },
    customer: { name: { first: "Bob", last: "Sledd" } },
  },
  application: {
    landParcels: [{ parcelId: "SD7560-9193", areaHa: 25.3874 }],
    hectaresTenOrOverYearsOld: 42,
    hectaresUnderTenYearsOld: 25,
  },
  parcels: [
    {
      id: "SD7560-9193",
      sheetId: "SD7560",
      parcelId: "9193",
      area: { quantity: 25.3874, unit: "ha" },
    },
  ],
  actions: [],
  items: [
    {
      id: "item:1",
      code: "PA3",
      description: "Woodland management plan",
      quantity: 55.4,
      unit: "ha",
      totalAmountPence: 166200,
    },
  ],
  totalAmountPence: 166200,
  state: "offered",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};

const transitionValues = {
  schemeCode: "$.agreement.schemeCode",
  name: "$.agreement.name",
  applicant: "$.agreement.applicant",
  application: "$.agreement.application",
  startDate: "$.outputs.CALCULATE_DATES.startDate",
  endDate: "$.outputs.CALCULATE_DATES.endDate",
  parcels: "$.agreement.parcels",
  actions: "$.agreement.actions",
  items: "$.agreement.items",
  totalAmountPence: "$.agreement.totalAmountPence",
};

const createDefinition = ({
  values = transitionValues,
  execute = vi.fn(),
} = {}) =>
  new AgreementDefinition(
    {
      code: "test-transition",
      configVersion: "1.0.0",
      agreementNumberPrefix: "TST",
      processDefinitions: {
        CALCULATE_DATES: {
          type: "endpoint",
          endpoint: {
            method: "POST",
            path: "/dates",
            service: "LAND_GRANTS",
          },
          request: {
            body: { parcelIds: "$.agreement.application.landParcels" },
          },
          output: {
            startDate: "$.response.startDate",
            endDate: "$.response.endDate",
          },
        },
        STAGE_RESULT: {
          type: "handler",
          input: {
            startDate: "$.agreement.startDate",
            endDate: "$.agreement.endDate",
            items: "$.agreement.items",
          },
        },
      },
      create: { target: "offered" },
      states: {
        offered: {
          page: "offered",
          on: {
            accept: {
              target: "accepted",
              values,
              processes: ["CALCULATE_DATES", "STAGE_RESULT"],
            },
          },
        },
        accepted: { page: "accepted" },
      },
      pages: {
        offered: {
          title: "Offered",
          components: [{ component: "heading", text: "Offered" }],
        },
        accepted: {
          title: "Accepted",
          components: [{ component: "heading", text: "Accepted" }],
        },
      },
    },
    {
      callEndpoint: vi.fn().mockResolvedValue({
        startDate: "2026-09-01",
        endDate: "2029-08-31",
      }),
      handlers: {
        STAGE_RESULT: {
          inputSchema: Joi.object({
            startDate: Joi.string().required(),
            endDate: Joi.string().required(),
            items: Joi.array().required(),
          }),
          execute,
          locations: ["transition"],
        },
      },
    },
  );

const runAcceptance = (definition, candidateAgreement = currentAgreement) =>
  definition.runProcesses({
    location: {
      type: "transition",
      state: "offered",
      transition: "accept",
    },
    context: {
      agreement: candidateAgreement,
      transition: { values: { confirm: "confirmed" } },
      execution: { executedAt: "2026-08-20T10:00:00.000Z" },
    },
  });

describe("AgreementDefinition transition-value mapping", () => {
  it("resolves one complete candidate before later handlers run", async () => {
    const execute = vi.fn();
    const definition = createDefinition({ execute });

    const result = await runAcceptance(definition);

    expect(result.agreementValues).toEqual({
      schemeCode: currentAgreement.schemeCode,
      name: currentAgreement.name,
      applicant: currentAgreement.applicant,
      application: currentAgreement.application,
      startDate: "2026-09-01",
      endDate: "2029-08-31",
      parcels: currentAgreement.parcels,
      actions: [],
      items: currentAgreement.items,
      totalAmountPence: 166200,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agreement: expect.objectContaining({
          agreementNumber: currentAgreement.agreementNumber,
          startDate: "2026-09-01",
          endDate: "2029-08-31",
          items: currentAgreement.items,
        }),
        input: {
          startDate: "2026-09-01",
          endDate: "2029-08-31",
          items: currentAgreement.items,
        },
      }),
    );
  });

  it("rejects an invalid complete candidate before a later handler runs", async () => {
    const execute = vi.fn();
    const values = { ...transitionValues, endDate: "2025-08-31" };
    const definition = createDefinition({ values, execute });

    await expect(runAcceptance(definition)).rejects.toThrow(
      "produced invalid transition values",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a partial candidate rather than applying patch semantics", async () => {
    const execute = vi.fn();
    const values = structuredClone(transitionValues);
    delete values.actions;
    const definition = createDefinition({ values, execute });

    await expect(runAcceptance(definition)).rejects.toThrow(
      "produced invalid transition values",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("prevents configuration from replacing immutable Application facts", async () => {
    const execute = vi.fn();
    const values = {
      ...transitionValues,
      application: { landParcels: [], secretMutation: true },
    };
    const definition = createDefinition({ values, execute });

    await expect(runAcceptance(definition)).rejects.toThrow(
      "cannot change immutable Agreement field",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects configuration-selected identities that do not already exist", async () => {
    const execute = vi.fn();
    const values = {
      ...transitionValues,
      items: [
        {
          id: "item:2",
          code: "PA3",
          quantity: 55.4,
          unit: "ha",
          totalAmountPence: 166200,
        },
      ],
    };
    const definition = createDefinition({ values, execute });

    await expect(runAcceptance(definition)).rejects.toThrow(
      "unknown stable Capital Item identity",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("allocates identities for new entries and resolves their schedule references", async () => {
    const execute = vi.fn();
    const values = {
      ...transitionValues,
      actions: [
        {
          ref: "calculated-action",
          code: "TEST1",
          totalAmountPence: 166200,
        },
      ],
      paymentSchedule: {
        instalments: [
          {
            dueDate: "2026-12-01",
            totalAmountPence: 166200,
            lineItems: [
              { actionRef: "calculated-action", amountPence: 166200 },
            ],
          },
        ],
      },
    };
    const definition = createDefinition({ values, execute });

    const result = await runAcceptance(definition);

    expect(result.agreementValues.actions).toEqual([
      {
        id: "action:1",
        code: "TEST1",
        totalAmountPence: 166200,
      },
    ]);
    expect(result.agreementValues.paymentSchedule).toEqual({
      instalments: [
        {
          id: "instalment:1",
          dueDate: "2026-12-01",
          totalAmountPence: 166200,
          lineItems: [{ actionId: "action:1", amountPence: 166200 }],
        },
      ],
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agreement: expect.objectContaining({
          actions: result.agreementValues.actions,
          paymentSchedule: result.agreementValues.paymentSchedule,
        }),
      }),
    );
  });

  it("allocates new identities after the highest identities in the current Agreement", async () => {
    const existingAction = { id: "action:1", code: "EXISTING" };
    const candidateAgreement = {
      ...currentAgreement,
      actions: [existingAction, { id: "action:3", code: "REMOVED-ACTION" }],
      items: [
        currentAgreement.items[0],
        { id: "item:3", code: "REMOVED-ITEM" },
      ],
      paymentSchedule: {
        instalments: [
          {
            id: "instalment:3",
            dueDate: "2026-11-01",
            totalAmountPence: 100,
            lineItems: [{ actionId: "action:1", amountPence: 100 }],
          },
        ],
      },
    };
    const values = {
      ...transitionValues,
      actions: [existingAction, { ref: "new-action", code: "NEW-ACTION" }],
      items: [currentAgreement.items[0], { ref: "new-item", code: "NEW-ITEM" }],
      paymentSchedule: {
        instalments: [
          {
            dueDate: "2026-12-01",
            totalAmountPence: 100,
            lineItems: [
              { actionRef: "new-action", amountPence: 50 },
              { itemRef: "new-item", amountPence: 50 },
            ],
          },
        ],
      },
    };
    const definition = createDefinition({ values });

    const result = await runAcceptance(definition, candidateAgreement);

    expect(result.agreementValues.actions[1].id).toBe("action:4");
    expect(result.agreementValues.items[1].id).toBe("item:4");
    expect(result.agreementValues.paymentSchedule.instalments[0].id).toBe(
      "instalment:4",
    );
  });

  it.each(["agreementNumber", "state", "version"])(
    "rejects configuration of protected Agreement field %s",
    (field) => {
      expect(() =>
        createDefinition({
          values: { ...transitionValues, [field]: "not-configurable" },
        }),
      ).toThrow(new RegExp(`${field}.*unknown`));
    },
  );

  it("requires transition value dependencies before staged handlers", () => {
    const values = {
      ...transitionValues,
      startDate: "$.outputs.CALCULATE_DATES.startDate",
    };
    const definitionData = structuredClone(createDefinitionData(values));
    definitionData.states.offered.on.accept.processes = [
      "STAGE_RESULT",
      "CALCULATE_DATES",
    ];

    expect(
      () =>
        new AgreementDefinition(definitionData, {
          callEndpoint: vi.fn(),
          handlers: {
            STAGE_RESULT: {
              inputSchema: Joi.object().unknown(true),
              execute: vi.fn(),
              locations: ["transition"],
            },
          },
        }),
    ).toThrow(/transition values.*CALCULATE_DATES.*before.*STAGE_RESULT/);
  });
});

const createDefinitionData = (values) => ({
  code: "test-transition",
  configVersion: "1.0.0",
  agreementNumberPrefix: "TST",
  processDefinitions: {
    CALCULATE_DATES: {
      type: "endpoint",
      endpoint: { method: "POST", path: "/dates", service: "LAND_GRANTS" },
      request: { body: {} },
      output: {
        startDate: "$.response.startDate",
        endDate: "$.response.endDate",
      },
    },
    STAGE_RESULT: { type: "handler", input: {} },
  },
  create: { target: "offered" },
  states: {
    offered: {
      page: "offered",
      on: {
        accept: {
          target: "accepted",
          values,
          processes: ["CALCULATE_DATES", "STAGE_RESULT"],
        },
      },
    },
    accepted: { page: "accepted" },
  },
  pages: {
    offered: {
      title: "Offered",
      components: [{ component: "heading", text: "Offered" }],
    },
    accepted: {
      title: "Accepted",
      components: [{ component: "heading", text: "Accepted" }],
    },
  },
});
