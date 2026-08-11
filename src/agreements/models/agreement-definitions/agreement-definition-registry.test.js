import { describe, expect, it, vi } from "vitest";
import { Agreement } from "../agreement.js";
import {
  agreementDefinitions,
  findAgreementDefinition,
} from "./agreement-definition-registry.js";
import { AgreementDefinition } from "./agreement-definition.js";

const pmfAgreementDefinition = agreementDefinitions.find(
  ({ code }) => code === "pigs-might-fly",
);

describe("findAgreementDefinition", () => {
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
    expect(paymentProcess).toEqual({
      type: "handler",
      input: {
        payment: {
          scheme: "SFI",
          sourceSystem: "FPTT",
          deliveryBody: "RP00",
          fesCode: "FALS_FPTT",
          ledger: "AP",
          currency: "GBP",
          marketingYear: "jsonata:$substring($.execution.executedAt, 0, 4)",
          invoiceLine: {
            schemeCode: "CMOR1",
            accountCode: "SOS710",
            fundCode: "DRD10",
          },
        },
      },
    });
    expect(JSON.stringify(acceptance)).not.toContain("callEndpoint");
    expect(JSON.stringify(acceptance)).not.toContain("paymentCalculation");
  });

  it("stages acceptance from stored values without calling an endpoint", async () => {
    const callEndpoint = vi.fn();
    const definition = new AgreementDefinition(pmfAgreementDefinition, {
      callEndpoint,
    });
    const agreement = new Agreement({
      agreementNumber: "PMF123456789",
      version: 1,
      code: "pigs-might-fly",
      clientRef: "test-client-ref",
      configVersion: pmfAgreementDefinition.configVersion,
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
    expect(result.commitOperations).toEqual([
      expect.objectContaining({
        type: "create-agreement-payment",
        request: expect.objectContaining({
          agreementValues: expect.objectContaining({
            actions: agreement.actions,
            paymentSchedule: agreement.paymentSchedule,
          }),
          paymentConfiguration: expect.objectContaining({
            marketingYear: "2027",
          }),
        }),
      }),
    ]);
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

  it("returns the code-specific default when another version is requested", () => {
    expect(
      findAgreementDefinition({
        code: "pigs-might-fly",
        configVersion: "3.0.0",
      }),
    ).toBe(pmfAgreementDefinition);
  });

  it("returns the code-specific default when no version is requested", () => {
    expect(findAgreementDefinition({ code: "pigs-might-fly" })).toBe(
      pmfAgreementDefinition,
    );
  });

  it("returns undefined when the code is unknown", () => {
    expect(
      findAgreementDefinition({
        code: "unknown-code",
        configVersion: "0.0.1",
      }),
    ).toBeUndefined();
  });

  it("ignores an unavailable version", () => {
    expect(
      findAgreementDefinition({
        code: "pigs-might-fly",
        configVersion: "0.0.0",
      }),
    ).toBe(pmfAgreementDefinition);
  });
});
