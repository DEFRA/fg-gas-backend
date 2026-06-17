import { describe, expect, it } from "vitest";
import {
  getAgreementAction,
  getAgreementCommandRoute,
  getAgreementCreation,
  getAgreementInitialStatus,
  isConfigBackedAgreement,
} from "./agreement-definition-resolver.js";

describe("Agreement definition resolver", () => {
  it("resolves PMF Agreement creation", () => {
    const creation = getAgreementCreation("pigs-might-fly");

    expect(isConfigBackedAgreement(creation)).toBe(true);
    expect(creation).toMatchObject({
      agreementCode: "pigs-might-fly",
      agreementNumberPrefix: "PMF",
      configVersion: "0.0.1",
      source: "config",
      initialStatus: "offered",
    });
  });

  it("resolves unknown Agreement creation as legacy", () => {
    const creation = getAgreementCreation("frps-beta");

    expect(isConfigBackedAgreement(creation)).toBe(false);
    expect(creation).toEqual({
      agreementCode: "frps-beta",
      agreementNumberPrefix: undefined,
      configVersion: undefined,
      source: "legacy",
      initialStatus: undefined,
    });
  });

  it("resolves the initial Agreement status", () => {
    expect(getAgreementInitialStatus("pigs-might-fly")).toBe("offered");
  });

  it("routes config-backed Agreement commands internally", () => {
    expect(
      getAgreementCommandRoute({
        agreementCode: "pigs-might-fly",
      }),
    ).toBe("internal");
  });

  it("routes unknown Agreement definitions to legacy", () => {
    expect(
      getAgreementCommandRoute({
        agreementCode: "frps-beta",
        commandName: "create",
      }),
    ).toBe("legacy");
  });

  it("resolves Agreement actions with publication expressed as configured effects", () => {
    expect(
      getAgreementAction({
        agreementCode: "pigs-might-fly",
        actionName: "accept",
      }),
    ).toMatchObject({
      actionName: "accept",
      agreementCode: "pigs-might-fly",
      fromStatus: "offered",
      effects: [
        {
          name: "createPaymentClaim",
          output: "paymentClaim",
          params: {
            fundingCalculation: "$.previousItemState.fundingCalculation",
            mapping: expect.objectContaining({
              items: "$.items",
              total: "$.grandTotal",
            }),
            paymentClaim: expect.objectContaining({
              deliveryBody: "RP00",
              sourceSystem: "FPTT",
            }),
            schedule: expect.objectContaining({
              durationMonths: 12,
            }),
          },
        },
        {
          fromStatus: "offered",
          name: "snapshot",
          params: {
            acceptedAt: "$.executedAt",
            acceptedBy: "$.command.acceptedBy",
            claimId: "$.outputs.paymentClaim.claimId",
            correlationId: "$.outputs.paymentClaim.correlationId",
            originalInvoiceNumber:
              "$.outputs.paymentClaim.originalInvoiceNumber",
            payment: "$.outputs.paymentClaim.payment",
          },
          target: "accepted",
        },
        {
          name: "publish",
          params: {
            event: "lifecycle",
          },
        },
      ],
      target: "agreementItem",
      toStatus: "accepted",
      validation: {
        page: "accept",
        required: [
          expect.objectContaining({
            name: "confirm",
            value: "confirmed",
          }),
        ],
      },
    });
  });

  it("rejects unknown Agreement actions", () => {
    expect(() =>
      getAgreementAction({
        agreementCode: "pigs-might-fly",
        actionName: "cancelAgreementItem",
      }),
    ).toThrow(
      'Agreement definition pigs-might-fly has no event named "cancelAgreementItem"',
    );
  });
});
