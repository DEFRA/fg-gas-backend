import { describe, expect, it, vi } from "vitest";
import { pmfAgreementDefinitionFixture } from "../../../../test/fixtures/pmf-agreement-definition.js";
import { Agreement } from "../agreement.js";
import { AgreementDefinition } from "./agreement-definition.js";
import { createAgreementProcessHandlers } from "./processes/agreement-process-registries.js";

const pmfAgreementDefinition = {
  ...structuredClone(pmfAgreementDefinitionFixture),
  configVersion: "1.2.0",
};

describe("PMF Agreement definition", () => {
  it("configures PMF offer calculation and Application resolution", () => {
    expect(pmfAgreementDefinition.create).toEqual({
      target: "offered",
      application: "$.input.answers",
      processes: ["GENERATE_OFFER"],
    });
    expect(pmfAgreementDefinition.create).not.toHaveProperty("effects");
    expect(pmfAgreementDefinition).not.toHaveProperty("endpoints");
    expect(
      pmfAgreementDefinition.processDefinitions.GENERATE_OFFER,
    ).toMatchObject({
      type: "endpoint",
      endpoint: {
        method: "POST",
        path: "/paymentSchedule",
        service: "GRANT_FUNDING_CALCULATOR",
      },
      request: {
        body: { agreementStartDate: "$.execution.executedAt" },
      },
      output: {
        startDate: "$.response.payment.agreementStartDate",
        endDate: "$.response.payment.agreementEndDate",
        actions: {
          items: {
            ref: "@.pigType",
            code: "@.pigType",
            unit: "head",
            ratePence: "@.unitPricePence",
            totalAmountPence: "@.amountPence",
          },
        },
        items: [],
        totalAmountPence: "$.response.payment.agreementTotalPence",
        paymentSchedule: expect.any(Object),
      },
    });
    expect(
      pmfAgreementDefinition.processDefinitions.GENERATE_OFFER.output.actions
        .items,
    ).not.toHaveProperty("id");
  });

  it("configures acceptance to stage Payment from stored Agreement values", () => {
    const acceptance = pmfAgreementDefinition.states.offered.on.accept;
    const paymentProcess =
      pmfAgreementDefinition.processDefinitions.CREATE_AGREEMENT_PAYMENT;

    expect(acceptance.processes).toEqual(["CREATE_AGREEMENT_PAYMENT"]);
    expect(acceptance).not.toHaveProperty("effects");
    expect(paymentProcess).toEqual({ type: "handler" });
    expect(JSON.stringify(acceptance)).not.toContain("callEndpoint");
    expect(JSON.stringify(acceptance)).not.toContain("paymentCalculation");
  });

  it("stages acceptance from stored values without calling an endpoint", async () => {
    const callEndpoint = vi.fn();
    const paymentConfiguration = {
      sbi: "300000069",
      frn: "1101234567",
      scheme: "SFI",
      sourceSystem: "FPTT",
      deliveryBody: "RP00",
      fesCode: "FALS_FPTT",
      originalInvoiceNumber: "",
      ledger: "AP",
      totalAmountPence: 5000,
      currency: "GBP",
      marketingYear: "2027",
      payments: [
        {
          dueDate: "2026-11-06",
          totalAmountPence: 5000,
          invoiceLines: [
            {
              schemeCode: "CMOR1",
              description: "Large White Pig",
              amountPence: 5000,
              accountCode: "SOS710",
              fundCode: "DRD10",
              deliveryBody: "RP00",
              marketingYear: "2027",
            },
          ],
        },
      ],
    };
    const prepareAgreementPayment = vi.fn().mockResolvedValue({
      commitOperations: [
        {
          type: "create-agreement-payment",
          request: { paymentConfiguration },
        },
      ],
    });
    const definition = new AgreementDefinition(pmfAgreementDefinition, {
      callEndpoint,
      handlers: createAgreementProcessHandlers({ prepareAgreementPayment }),
    });
    const agreement = new Agreement({
      agreementNumber: "PMF123456789",
      version: 1,
      code: "pigs-might-fly",
      clientRef: "test-client-ref",
      configVersion: "1.0.1",
      correlationId: "agreement-correlation-id",
      identifiers: { sbi: "300000069" },
      application: {},
      state: "offered",
      startDate: "2026-08-01",
      endDate: "2027-07-31",
      actions: [
        {
          id: "action:1",
          code: "largeWhite",
          description: "Large White Pig",
        },
      ],
      items: [],
      totalAmountPence: 5000,
      paymentSchedule: {
        instalments: [
          {
            id: "instalment:1",
            dueDate: "2026-11-06",
            totalAmountPence: 5000,
            lineItems: [{ actionId: "action:1", amountPence: 5000 }],
          },
        ],
      },
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    });

    const result = await definition.executeAction({
      agreement,
      actionName: "accept",
      values: { confirm: "confirmed" },
      execution: {
        correlationId: agreement.correlationId,
        executedAt: "2027-01-02T10:00:00.000Z",
      },
    });

    expect(callEndpoint).not.toHaveBeenCalled();
    expect(prepareAgreementPayment).toHaveBeenCalledWith({
      execution: {
        correlationId: agreement.correlationId,
        executedAt: "2027-01-02T10:00:00.000Z",
        location: "transition",
        target: "accepted",
      },
      agreement: expect.objectContaining({
        agreementNumber: agreement.agreementNumber,
        clientRef: agreement.clientRef,
        code: agreement.code,
      }),
      input: {},
    });
    expect(result.agreement.configVersion).toBe("1.2.0");
    expect(result.commitOperations).toEqual([
      expect.objectContaining({
        type: "create-agreement-payment",
        request: {
          paymentConfiguration: expect.objectContaining({
            marketingYear: "2027",
          }),
        },
      }),
    ]);
  });

  it("configures withdrawal without a Payment operation", async () => {
    const definition = new AgreementDefinition(pmfAgreementDefinition);
    const agreement = new Agreement({
      agreementNumber: "PMF123456789",
      version: 1,
      code: "pigs-might-fly",
      clientRef: "test-client-ref",
      configVersion: "1.0.1",
      correlationId: "agreement-correlation-id",
      identifiers: { sbi: "300000069" },
      application: {},
      state: "offered",
      actions: [],
      items: [],
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    });

    const action = definition.resolveActionForStatus({
      state: "offered",
      status: "withdrawn",
    });
    const result = await definition.executeAction({
      agreement,
      actionName: action.transition.action,
      values: {},
      execution: {
        correlationId: agreement.correlationId,
        executedAt: "2026-08-02T10:00:00.000Z",
      },
    });

    expect(action.transition).toEqual({
      from: "offered",
      action: "withdraw",
      target: "withdrawn",
    });
    expect(result.agreement.state).toBe("withdrawn");
    expect(result.commitOperations).toEqual([]);
  });

  it("configures cancellation without a Payment operation", async () => {
    const definition = new AgreementDefinition(pmfAgreementDefinition);
    const agreement = new Agreement({
      agreementNumber: "PMF123456789",
      version: 1,
      code: "pigs-might-fly",
      clientRef: "test-client-ref",
      configVersion: "1.0.1",
      correlationId: "agreement-correlation-id",
      identifiers: { sbi: "300000069" },
      application: {},
      state: "offered",
      actions: [],
      items: [],
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    });

    const action = definition.resolveActionForStatus({
      state: "offered",
      status: "cancelled",
    });
    const result = await definition.executeAction({
      agreement,
      actionName: action.transition.action,
      values: {},
      execution: {
        correlationId: agreement.correlationId,
        executedAt: "2026-08-02T10:00:00.000Z",
      },
    });

    expect(action.transition).toEqual({
      from: "offered",
      action: "cancel",
      target: "cancelled",
    });
    expect(result.agreement.state).toBe("cancelled");
    expect(result.commitOperations).toEqual([]);
  });

  it("terminates an accepted Agreement without touching its Payment", async () => {
    const definition = new AgreementDefinition(pmfAgreementDefinition);
    const paymentSchedule = {
      instalments: [
        {
          id: "instalment:1",
          dueDate: "2026-11-06",
          totalAmountPence: 5000,
          lineItems: [{ actionId: "action:1", amountPence: 5000 }],
        },
      ],
    };
    const agreement = new Agreement({
      agreementNumber: "PMF123456789",
      version: 1,
      code: "pigs-might-fly",
      clientRef: "test-client-ref",
      configVersion: "1.0.1",
      correlationId: "agreement-correlation-id",
      identifiers: { sbi: "300000069" },
      application: {},
      state: "accepted",
      startDate: "2026-08-01",
      endDate: "2027-07-31",
      acceptedAt: "2026-08-02T10:00:00.000Z",
      actions: [],
      items: [],
      totalAmountPence: 5000,
      paymentSchedule,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    });

    const action = definition.resolveActionForStatus({
      state: "accepted",
      status: "terminated",
    });
    const result = await definition.executeAction({
      agreement,
      actionName: action.transition.action,
      values: {},
      execution: {
        correlationId: agreement.correlationId,
        executedAt: "2027-01-02T10:00:00.000Z",
      },
    });

    expect(action.transition).toEqual({
      from: "accepted",
      action: "terminate",
      target: "terminated",
    });
    expect(result.agreement.state).toBe("terminated");
    expect(result.commitOperations).toEqual([]);
    expect(result.agreement.paymentSchedule).toEqual(paymentSchedule);
    expect(result.agreement.totalAmountPence).toBe(5000);
    expect(result.agreement.acceptedAt).toBe("2026-08-02T10:00:00.000Z");
    expect(result.agreement.startDate).toBe("2026-08-01");
  });

  it("binds PMF pages only to stored Agreement values", () => {
    const pages = JSON.stringify(pmfAgreementDefinition.pages);

    expect(pages).toContain("$.agreement.actions");
    expect(pages).toContain("$.agreement.paymentSchedule.instalments");
    expect(pages).toContain("$.agreement.startDate");
    expect(pages).not.toContain("paymentCalculation");
    expect(pages).not.toContain("supplementaryData");
    expect(pages).not.toContain("agreement.payload");
  });
});
