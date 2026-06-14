import { describe, expect, it } from "vitest";
import {
  getAgreementAction,
  getAgreementCommandRoute,
  getAgreementCreation,
  getAgreementInitialVersion,
  isConfigBackedAgreement,
} from "./agreement-definition-resolver.js";
import { agreementCommandNames } from "./agreement-definition.js";

describe("Agreement definition resolver", () => {
  it("resolves PMF Agreement creation", () => {
    const creation = getAgreementCreation("pigs-might-fly");

    expect(isConfigBackedAgreement(creation)).toBe(true);
    expect(creation).toMatchObject({
      agreementCode: "pigs-might-fly",
      agreementNumber: {
        prefix: "PMF",
        randomDigits: 9,
        uniquenessScope: "agreementNumber",
      },
      configVersion: "0.0.1",
      implementation: "config",
      initialVersion: {
        changedBy: "system",
        changeType: "created",
        fromStatus: null,
        initialStatus: "offered",
      },
    });
  });

  it("resolves unknown Agreement creation as legacy", () => {
    const creation = getAgreementCreation("frps-beta");

    expect(isConfigBackedAgreement(creation)).toBe(false);
    expect(creation).toEqual({
      agreementCode: "frps-beta",
      agreementNumber: undefined,
      configVersion: undefined,
      implementation: "legacy",
      initialVersion: undefined,
    });
  });

  it("resolves initial Agreement version values", () => {
    expect(getAgreementInitialVersion("pigs-might-fly")).toEqual({
      changedBy: "system",
      changeType: "created",
      fromStatus: null,
      initialStatus: "offered",
    });
  });

  it("routes PMF create commands internally", () => {
    expect(
      getAgreementCommandRoute({
        agreementCode: "pigs-might-fly",
        commandName: agreementCommandNames.CREATE,
      }),
    ).toBe("internal");
  });

  it("routes unknown Agreement commands to legacy", () => {
    expect(
      getAgreementCommandRoute({
        agreementCode: "pigs-might-fly",
        commandName: "cancel",
      }),
    ).toBe("legacy");
  });

  it("routes unknown Agreement definitions to legacy", () => {
    expect(
      getAgreementCommandRoute({
        agreementCode: "frps-beta",
        commandName: agreementCommandNames.CREATE,
      }),
    ).toBe("legacy");
  });

  it("resolves Agreement actions with publication expressed as configured steps", () => {
    expect(
      getAgreementAction({
        agreementCode: "pigs-might-fly",
        actionName: "accept",
      }),
    ).toMatchObject({
      actionName: "accept",
      agreementCode: "pigs-might-fly",
      fromStatus: "offered",
      processingSteps: [
        {
          payment: "$.item.payload.answers.payment",
          paymentClaim: expect.objectContaining({
            deliveryBody: "RP00",
            sourceSystem: "FPTT",
          }),
          type: "createPaymentClaim",
        },
        {
          fromStatus: "offered",
          itemPatch: {
            acceptedAt: "$.executedAt",
            acceptedBy: "$.command.acceptedBy",
            claimId: "$.action.paymentClaim.claimId",
            correlationId: "$.action.paymentClaim.correlationId",
            originalInvoiceNumber:
              "$.action.paymentClaim.originalInvoiceNumber",
            payment: "$.action.paymentClaim.payment",
          },
          toStatus: "accepted",
          type: "recordTransition",
        },
        {
          paymentClaim: expect.objectContaining({
            deliveryBody: "RP00",
            sourceSystem: "FPTT",
          }),
          type: "emitLifecycleEvent",
        },
      ],
      target: "agreementItem",
      toStatus: "accepted",
    });
  });

  it("rejects unknown Agreement actions", () => {
    expect(() =>
      getAgreementAction({
        agreementCode: "pigs-might-fly",
        actionName: "cancelAgreementItem",
      }),
    ).toThrow(
      'Agreement definition pigs-might-fly has no action named "cancelAgreementItem"',
    );
  });
});
