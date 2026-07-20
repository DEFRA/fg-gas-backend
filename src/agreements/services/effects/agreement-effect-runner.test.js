import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementItem } from "../../models/agreement-item.js";
import { runAgreementEffects } from "./agreement-effect-runner.js";
import { callAgreementEndpoint } from "./call-agreement-endpoint.js";

vi.mock("./call-agreement-endpoint.js");

const endpoint = {
  code: "calculate-payment",
  method: "POST",
  path: "/calculate-payment",
  service: "PAYMENT_SERVICE",
};

const callEndpoint = {
  name: "callEndpoint",
  output: "paymentClaim",
  params: {
    endpoint: {
      code: endpoint.code,
      endpointParams: {
        BODY: { quantity: "$.answers.quantity ?? 0" },
      },
    },
  },
};

const snapshot = {
  name: "snapshot",
  params: {
    acceptedAt: "$.executedAt",
    claimId: "$.outputs.paymentClaim.claimId",
    correlationId: "$.outputs.paymentClaim.correlationId",
    originalInvoiceNumber: "$.outputs.paymentClaim.originalInvoiceNumber",
    payment: "$.outputs.paymentClaim.payment",
    supplementaryData: {
      calculatedPayment: "$.outputs.paymentClaim.payment",
    },
  },
};

const publish = {
  name: "publish",
  params: { event: "lifecycle" },
};

const createContext = (overrides = {}) => ({
  agreement: { agreementNumber: "PMF823153884" },
  item: new AgreementItem({
    agreementCode: "pigs-might-fly",
    clientRef: "xnp-rr3-nfb",
    state: "offered",
    supplementaryData: { preserved: true },
  }),
  answers: { quantity: 5 },
  endpoints: [endpoint],
  executedAt: "2026-07-17T11:29:00.000Z",
  target: "accepted",
  version: 2,
  ...overrides,
});

describe("runAgreementEffects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs configured effects in order and passes each result to the next", async () => {
    const paymentClaim = {
      claimId: "R00000001",
      correlationId: "payment-correlation-id",
      originalInvoiceNumber: "R00000001-V001Q1",
      payment: { payments: [{ amount: 300 }] },
    };
    const existingEvent = { target: "existing-topic", event: { id: "one" } };
    callAgreementEndpoint.mockResolvedValue(paymentClaim);

    const result = await runAgreementEffects(
      [callEndpoint, snapshot, publish],
      createContext({
        outputs: { existing: "kept" },
        outboundEvents: [existingEvent],
      }),
    );

    expect(callAgreementEndpoint).toHaveBeenCalledWith(endpoint, {
      BODY: { quantity: 5 },
    });
    expect(result.outputs).toEqual({
      existing: "kept",
      paymentClaim,
    });
    expect(result.item).toMatchObject({
      state: "offered",
      acceptedAt: "2026-07-17T11:29:00.000Z",
      ...paymentClaim,
      supplementaryData: {
        preserved: true,
        calculatedPayment: paymentClaim.payment,
      },
    });
    expect(result.outboundEvents).toHaveLength(2);
    expect(result.outboundEvents[0]).toBe(existingEvent);
    expect(result.outboundEvents[1]).toMatchObject({
      target: "some:arn",
      event: {
        type: "cloud.defra.local.fg-gas-backend.agreement.status.updated",
        data: {
          agreementNumber: "PMF823153884",
          clientRef: "xnp-rr3-nfb",
          code: "pigs-might-fly",
          version: 2,
          status: "accepted",
          date: "2026-07-17T11:29:00.000Z",
        },
      },
    });
  });

  it("does not store a handler result when the effect has no output name", async () => {
    callAgreementEndpoint.mockResolvedValue({ amount: 500 });

    const result = await runAgreementEffects(
      [{ ...callEndpoint, output: undefined }],
      createContext(),
    );

    expect(result.outputs).toEqual({});
  });

  it("rejects an endpoint that is not configured", async () => {
    await expect(
      runAgreementEffects([callEndpoint], createContext({ endpoints: [] })),
    ).rejects.toThrow('No endpoint configured for code "calculate-payment"');

    expect(callAgreementEndpoint).not.toHaveBeenCalled();
  });

  it("rejects an unsupported publication", async () => {
    await expect(
      runAgreementEffects(
        [{ ...publish, params: { event: "unsupported" } }],
        createContext(),
      ),
    ).rejects.toThrow('Unsupported Agreement publication: "unsupported"');
  });

  it("rejects an unsupported effect before running later effects", async () => {
    await expect(
      runAgreementEffects(
        [{ name: "unknownEffect" }, callEndpoint],
        createContext(),
      ),
    ).rejects.toThrow(
      'Unsupported agreement effect: "unknownEffect". Supported effects are: snapshot, publish, callEndpoint, createPaymentClaim',
    );

    expect(callAgreementEndpoint).not.toHaveBeenCalled();
  });

  it("reports the payment claim handler as not implemented", async () => {
    await expect(
      runAgreementEffects([{ name: "createPaymentClaim" }], createContext()),
    ).rejects.toThrow("createPaymentClaim handler not yet implemented");
  });
});
