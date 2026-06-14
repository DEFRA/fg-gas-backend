import { describe, expect, it } from "vitest";
import { getAgreementDefinition } from "./agreement-definition.js";
import {
  assertValidAgreementDefinition,
  validateAgreementDefinition,
} from "./agreement-definition.schema.js";

const createValidDefinition = () =>
  structuredClone(getAgreementDefinition("pigs-might-fly"));

const assertDefinitionInvalid = ({ definition, message }) => {
  expect(() =>
    assertValidAgreementDefinition({
      agreementCode: "test-agreement",
      definition,
    }),
  ).toThrow(message);
};

describe("Agreement definition schema", () => {
  it("accepts the configured PMF Agreement definition", () => {
    const { error } = validateAgreementDefinition(createValidDefinition());

    expect(error).toBeUndefined();
  });

  it("allows payment config to be supplied by step overrides", () => {
    const definition = createValidDefinition();
    const paymentClaim = structuredClone(definition.payment.claim);
    const action = definition.lifecycle.actions.accept;

    delete definition.payment;
    action.steps = [
      {
        type: "recordTransition",
        itemPatch: {
          acceptedAt: "$.executedAt",
          acceptedBy: "$.command.acceptedBy",
          payment: "$.item.payload.answers.payment",
        },
      },
      {
        type: "createPaymentClaim",
        payment: "$.item.payload.answers.payment",
        paymentClaim,
      },
      "emitLifecycleEvent",
    ];

    const { error } = validateAgreementDefinition(definition);

    expect(error).toBeUndefined();
  });

  it("accepts an FPTT-shaped action definition without making it live", () => {
    const definition = createValidDefinition();

    definition.agreementCode = "frps-private-beta";
    definition.agreementNumber.prefix = "FPTT";
    definition.endpoints = [
      {
        code: "calculate-fptt-payments",
        method: "POST",
        path: "/api/v2/payments/calculate",
        service: "LAND_GRANTS",
      },
    ];
    definition.lifecycle.actions.accept.steps = [
      {
        endpoint: {
          code: "calculate-fptt-payments",
          endpointParams: {
            BODY: {
              parcel: "$.item.payload.application.parcel",
            },
          },
        },
        output: {
          path: "payment",
          place: "replace",
          select: "$.response.payment",
        },
        type: "callEndpoint",
      },
      {
        payment: "$.action.payment",
        type: "createPaymentClaim",
      },
      {
        itemPatch: {
          acceptedAt: "$.executedAt",
          acceptedBy: "$.command.acceptedBy",
          claimId: "$.action.paymentClaim.claimId",
          correlationId: "$.action.paymentClaim.correlationId",
          originalInvoiceNumber: "$.action.paymentClaim.originalInvoiceNumber",
          payment: "$.action.paymentClaim.payment",
        },
        type: "recordTransition",
      },
      "emitLifecycleEvent",
    ];

    const { error } = validateAgreementDefinition(definition);

    expect(error).toBeUndefined();
  });

  it("accepts a WMP-shaped action definition without making it live", () => {
    const definition = createValidDefinition();

    definition.agreementCode = "woodland";
    definition.agreementNumber.prefix = "WMP";
    delete definition.payment;
    definition.endpoints = [
      {
        code: "calculate-wmp-dates",
        method: "POST",
        path: "/api/v1/wmp/payments/calculate",
        service: "LAND_GRANTS",
      },
    ];
    definition.lifecycle.actions.accept.steps = [
      {
        endpoint: {
          code: "calculate-wmp-dates",
          endpointParams: {
            BODY: {
              parcelIds: "$.item.payload.application.parcelIds",
              schemeData: "$.item.payload.schemeData",
            },
          },
        },
        output: {
          path: "agreementDates",
          place: "replace",
          select: "$.response",
        },
        type: "callEndpoint",
      },
      {
        itemPatch: {
          acceptedAt: "$.executedAt",
          acceptedBy: "$.command.acceptedBy",
          payment: {
            agreementEndDate: "$.action.agreementDates.agreementEndDate",
            agreementStartDate: "$.action.agreementDates.agreementStartDate",
            schedule: "$.item.payload.answers.payments.agreement",
          },
        },
        type: "recordTransition",
      },
      "emitLifecycleEvent",
    ];

    const { error } = validateAgreementDefinition(definition);

    expect(error).toBeUndefined();
  });

  it("accepts callEndpoint output targets", () => {
    const definition = createValidDefinition();

    definition.lifecycle.actions.accept.steps = [
      {
        endpoint: {
          code: "calculate-payment-schedule",
        },
        output: {
          select: "$.response.payment",
          target: {
            dataType: "OBJECT",
            key: "code",
            place: "append",
            targetNode: "paymentPreparations",
          },
        },
        type: "callEndpoint",
      },
      {
        type: "recordTransition",
      },
    ];

    const { error } = validateAgreementDefinition(definition);

    expect(error).toBeUndefined();
  });

  it("rejects createPaymentClaim steps without payment claim config", () => {
    const definition = createValidDefinition();

    delete definition.payment.claim;

    assertDefinitionInvalid({
      definition,
      message: /createPaymentClaim steps require payment\.claim/,
    });
  });

  it("rejects unknown lifecycle action steps", () => {
    const definition = createValidDefinition();

    definition.lifecycle.actions.accept.steps = [
      { type: "recordTransition" },
      { type: "postPayment" },
    ];

    assertDefinitionInvalid({
      definition,
      message: /lifecycle\.actions\.accept\.steps/,
    });
  });

  it("rejects callEndpoint steps without a matching endpoint", () => {
    const definition = createValidDefinition();

    definition.lifecycle.actions.accept.steps = [
      {
        endpoint: {
          code: "missing-endpoint",
          endpointParams: {
            BODY: {
              payment: "$.item.payload.answers.payment",
            },
          },
        },
        output: {
          path: "payment",
          place: "replace",
          select: "$.response.payment",
        },
        type: "callEndpoint",
      },
    ];

    assertDefinitionInvalid({
      definition,
      message:
        /callEndpoint steps require an endpoint matching step\.endpoint\.code/,
    });
  });

  it("rejects unsupported callEndpoint output target places", () => {
    const definition = createValidDefinition();

    definition.lifecycle.actions.accept.steps = [
      {
        endpoint: {
          code: "calculate-payment-schedule",
        },
        output: {
          target: {
            dataType: "ARRAY",
            place: "replace",
            targetNode: "paymentPreparations",
          },
        },
        type: "callEndpoint",
      },
    ];

    assertDefinitionInvalid({
      definition,
      message: /lifecycle\.actions\.accept\.steps/,
    });
  });

  it("rejects object output targets without a key", () => {
    const definition = createValidDefinition();

    definition.lifecycle.actions.accept.steps = [
      {
        endpoint: {
          code: "calculate-payment-schedule",
        },
        output: {
          target: {
            dataType: "OBJECT",
            place: "append",
            targetNode: "paymentPreparations",
          },
        },
        type: "callEndpoint",
      },
    ];

    assertDefinitionInvalid({
      definition,
      message: /lifecycle\.actions\.accept\.steps/,
    });
  });

  it("rejects payment result command processing config", () => {
    const definition = createValidDefinition();

    definition.commands.paymentSucceeded = {
      processing: {
        changedBy: "payment",
        fromStatus: "acceptancePending",
        steps: [{ type: "createPaymentClaim" }],
        toStatus: "accepted",
      },
    };

    assertDefinitionInvalid({
      definition,
      message: /commands\.paymentSucceeded/,
    });
  });
});
