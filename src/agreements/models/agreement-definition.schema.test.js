import { describe, expect, it } from "vitest";
import { getAgreementDefinition } from "./agreement-definition.js";
import {
  assertValidAgreementDefinition,
  validateAgreementDefinition,
} from "./agreement-definition.schema.js";

const createValidDefinition = () =>
  structuredClone(getAgreementDefinition("pigs-might-fly"));

const getAcceptTransition = (definition) => definition.states.offered.on.accept;

const getPaymentClaim = (definition) =>
  getAcceptTransition(definition).effects.find(
    (effect) => effect.name === "createPaymentClaim",
  ).params.paymentClaim;

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

  it("rejects action payload validation config", () => {
    const definition = createValidDefinition();
    const transition = getAcceptTransition(definition);

    transition.payload = {
      required: [
        {
          name: "confirm",
          value: "confirmed",
        },
      ],
    };
    delete transition.validation;

    assertDefinitionInvalid({
      definition,
      message: /states\.offered\.on\.accept\.payload/,
    });
  });

  it("accepts payment claim config supplied by effect params", () => {
    const definition = createValidDefinition();
    const paymentClaim = structuredClone(getPaymentClaim(definition));
    const transition = getAcceptTransition(definition);

    transition.effects = [
      {
        name: "createPaymentClaim",
        output: "paymentClaim",
        params: {
          payment: "$.item.payload.answers.payment",
          paymentClaim,
        },
      },
      {
        name: "snapshot",
        params: {
          acceptedAt: "$.executedAt",
          acceptedBy: "$.command.acceptedBy",
          payment: "$.outputs.paymentClaim.payment",
        },
      },
      {
        name: "publish",
        params: { event: "lifecycle" },
      },
    ];

    const { error } = validateAgreementDefinition(definition);

    expect(error).toBeUndefined();
  });

  it("accepts an FPTT-shaped transition definition without making it live", () => {
    const definition = createValidDefinition();

    definition.code = "frps-private-beta";
    definition.agreementNumberPrefix = "FPTT";
    definition.create.effects = [];
    definition.endpoints = [
      {
        code: "calculate-fptt-payments",
        method: "POST",
        path: "/api/v2/payments/calculate",
        service: "LAND_GRANTS",
      },
    ];
    getAcceptTransition(definition).effects = [
      {
        name: "callEndpoint",
        output: "payment",
        params: {
          endpoint: {
            code: "calculate-fptt-payments",
            endpointParams: {
              BODY: {
                parcel: "$.item.payload.application.parcel",
              },
            },
          },
          output: {
            select: "$.response.payment",
          },
        },
      },
      {
        name: "createPaymentClaim",
        output: "paymentClaim",
        params: {
          payment: "$.outputs.payment",
          paymentClaim: getPaymentClaim(definition),
        },
      },
      {
        name: "snapshot",
        params: {
          acceptedAt: "$.executedAt",
          acceptedBy: "$.command.acceptedBy",
          claimId: "$.outputs.paymentClaim.claimId",
          correlationId: "$.outputs.paymentClaim.correlationId",
          originalInvoiceNumber: "$.outputs.paymentClaim.originalInvoiceNumber",
          payment: "$.outputs.paymentClaim.payment",
        },
      },
      {
        name: "publish",
        params: { event: "lifecycle" },
      },
    ];

    const { error } = validateAgreementDefinition(definition);

    expect(error).toBeUndefined();
  });

  it("accepts a WMP-shaped transition definition without making it live", () => {
    const definition = createValidDefinition();

    definition.code = "woodland";
    definition.agreementNumberPrefix = "WMP";
    definition.create.effects = [];
    definition.endpoints = [
      {
        code: "calculate-wmp-dates",
        method: "POST",
        path: "/api/v1/wmp/payments/calculate",
        service: "LAND_GRANTS",
      },
    ];
    getAcceptTransition(definition).effects = [
      {
        name: "callEndpoint",
        output: "agreementDates",
        params: {
          endpoint: {
            code: "calculate-wmp-dates",
            endpointParams: {
              BODY: {
                parcelIds: "$.item.payload.application.parcelIds",
                schemeData: "$.item.payload.schemeData",
              },
            },
          },
        },
      },
      {
        name: "snapshot",
        params: {
          acceptedAt: "$.executedAt",
          acceptedBy: "$.command.acceptedBy",
          payment: {
            agreementEndDate: "$.outputs.agreementDates.agreementEndDate",
            agreementStartDate: "$.outputs.agreementDates.agreementStartDate",
            schedule: "$.item.payload.answers.payments.agreement",
          },
        },
      },
      {
        name: "publish",
        params: { event: "lifecycle" },
      },
    ];

    const { error } = validateAgreementDefinition(definition);

    expect(error).toBeUndefined();
  });

  it("accepts callEndpoint output targets", () => {
    const definition = createValidDefinition();

    getAcceptTransition(definition).effects = [
      {
        name: "callEndpoint",
        params: {
          endpoint: {
            code: "calculate-funding",
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
        },
      },
      {
        name: "snapshot",
        params: {},
      },
    ];

    const { error } = validateAgreementDefinition(definition);

    expect(error).toBeUndefined();
  });

  it("rejects createPaymentClaim effects without payment claim config", () => {
    const definition = createValidDefinition();

    const createPaymentClaimEffect = getAcceptTransition(
      definition,
    ).effects.find((effect) => effect.name === "createPaymentClaim");

    delete createPaymentClaimEffect.params.paymentClaim;

    assertDefinitionInvalid({
      definition,
      message: /createPaymentClaim effects require params\.paymentClaim/,
    });
  });

  it("rejects unknown transition effects", () => {
    const definition = createValidDefinition();

    getAcceptTransition(definition).effects = [
      { name: "snapshot", params: {} },
      { name: "postPayment" },
    ];

    assertDefinitionInvalid({
      definition,
      message: /states\.offered\.on\.accept\.effects/,
    });
  });

  it("rejects callEndpoint effects without a matching endpoint", () => {
    const definition = createValidDefinition();

    getAcceptTransition(definition).effects = [
      {
        name: "callEndpoint",
        params: {
          endpoint: {
            code: "missing-endpoint",
            endpointParams: {
              BODY: {
                payment: "$.item.payload.answers.payment",
              },
            },
          },
          output: {
            select: "$.response.payment",
          },
        },
      },
      { name: "snapshot", params: {} },
    ];

    assertDefinitionInvalid({
      definition,
      message:
        /callEndpoint effects require an endpoint matching params\.endpoint\.code/,
    });
  });

  it("rejects unsupported callEndpoint output target places", () => {
    const definition = createValidDefinition();

    getAcceptTransition(definition).effects = [
      {
        name: "callEndpoint",
        params: {
          endpoint: {
            code: "calculate-funding",
          },
          output: {
            target: {
              dataType: "ARRAY",
              place: "replace",
              targetNode: "paymentPreparations",
            },
          },
        },
      },
      { name: "snapshot", params: {} },
    ];

    assertDefinitionInvalid({
      definition,
      message: /states\.offered\.on\.accept\.effects/,
    });
  });

  it("rejects config-backed definitions without pages", () => {
    const definition = createValidDefinition();

    delete definition.pages;

    assertDefinitionInvalid({
      definition,
      message: /"pages" is required/,
    });
  });

  it("rejects object output targets without a key", () => {
    const definition = createValidDefinition();

    getAcceptTransition(definition).effects = [
      {
        name: "callEndpoint",
        params: {
          endpoint: {
            code: "calculate-funding",
          },
          output: {
            target: {
              dataType: "OBJECT",
              place: "append",
              targetNode: "paymentPreparations",
            },
          },
        },
      },
      { name: "snapshot", params: {} },
    ];

    assertDefinitionInvalid({
      definition,
      message: /states\.offered\.on\.accept\.effects/,
    });
  });

  it("rejects command routing config", () => {
    const definition = createValidDefinition();

    definition.commands = {
      create: {
        route: "internal",
      },
    };

    assertDefinitionInvalid({
      definition,
      message: /commands/,
    });
  });
});
