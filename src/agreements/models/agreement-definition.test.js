import { describe, expect, it } from "vitest";
import {
  agreementCommandRoutes,
  agreementImplementations,
  getAgreementDefinition,
} from "./agreement-definition.js";

describe("Agreement definition", () => {
  it("defines PMF as a config-backed Agreement", () => {
    expect(getAgreementDefinition("pigs-might-fly")).toEqual({
      agreementCode: "pigs-might-fly",
      implementation: agreementImplementations.CONFIG,
      configVersion: "0.0.1",
      agreementNumber: {
        prefix: "PMF",
        randomDigits: 9,
        uniquenessScope: "agreementNumber",
      },
      endpoints: [
        {
          code: "calculate-payment-schedule",
          method: "POST",
          path: "/api/v2/payments/calculate",
          service: "LAND_GRANTS",
        },
        {
          code: "calculate-agreement-dates",
          method: "POST",
          path: "/api/v1/wmp/payments/calculate",
          service: "LAND_GRANTS",
        },
      ],
      commands: {
        create: {
          route: agreementCommandRoutes.INTERNAL,
        },
      },
      lifecycle: {
        initialStatus: "offered",
        initialChangeType: "created",
        changedBy: "system",
        fromStatus: null,
        actions: {
          accept: {
            target: "agreementItem",
            fromStatus: "offered",
            toStatus: "accepted",
            steps: [
              {
                type: "createPaymentClaim",
                payment: "$.item.payload.answers.payment",
              },
              {
                type: "recordTransition",
                itemPatch: {
                  acceptedAt: "$.executedAt",
                  acceptedBy: "$.command.acceptedBy",
                  claimId: "$.action.paymentClaim.claimId",
                  correlationId: "$.action.paymentClaim.correlationId",
                  originalInvoiceNumber:
                    "$.action.paymentClaim.originalInvoiceNumber",
                  payment: "$.action.paymentClaim.payment",
                },
              },
              { type: "emitLifecycleEvent" },
            ],
          },
        },
      },
      payment: {
        claim: {
          defaultCurrency: "GBP",
          deliveryBody: "RP00",
          invoiceNumber: {
            requestPadding: 3,
            requestPrefix: "V",
            suffix: "QX",
          },
          lineItemTypes: [
            {
              descriptionTemplate:
                "{paymentDate}: Parcel: {item.parcelId}: {item.description}",
              idField: "parcelItemId",
              itemsPath: "parcelItems",
              schemeCodePath: "item.code",
            },
            {
              descriptionTemplate:
                "{paymentDate}: One-off payment per agreement per year for {item.description}",
              idField: "agreementLevelItemId",
              itemsPath: "agreementLevelItems",
              schemeCodePath: "item.code",
            },
          ],
          marketingYear: "currentYear",
          paymentRequestNumber: 1,
          scheme: "SFI",
          sourceSystem: "FPTT",
        },
      },
    });
  });

  it("treats unknown Agreement codes as legacy", () => {
    expect(getAgreementDefinition("frps-beta")).toEqual({
      agreementCode: "frps-beta",
      implementation: agreementImplementations.LEGACY,
    });
  });
});
