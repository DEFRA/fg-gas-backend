import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementItem } from "../../models/agreement-item.js";
import { runAgreementEffects } from "./agreement-effect-runner.js";
import { callAgreementEndpoint } from "./call-agreement-endpoint.js";

vi.mock("./call-agreement-endpoint.js");

const endpoint = {
  code: "calculate-funding",
  method: "POST",
  path: "/calculate-funding",
  service: "GRANT_FUNDING_CALCULATOR",
};

const callEndpoint = {
  name: "callEndpoint",
  output: "fundingCalculation",
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
    supplementaryData: {
      fundingCalculation: "$.outputs.fundingCalculation",
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
    const fundingCalculation = {
      items: [{ description: "Large White", total: 300 }],
    };
    const existingEvent = { target: "existing-topic", event: { id: "one" } };
    callAgreementEndpoint.mockResolvedValue(fundingCalculation);

    const result = await runAgreementEffects(
      [callEndpoint, snapshot, publish],
      createContext({
        outputs: { existing: "kept" },
        outboxEvents: [existingEvent],
      }),
    );

    expect(callAgreementEndpoint).toHaveBeenCalledWith(endpoint, {
      BODY: { quantity: 5 },
    });
    expect(result.outputs).toEqual({
      existing: "kept",
      fundingCalculation,
    });
    expect(result.item).toMatchObject({
      state: "offered",
      acceptedAt: "2026-07-17T11:29:00.000Z",
      supplementaryData: {
        preserved: true,
        fundingCalculation,
      },
    });
    expect(result.outboxEvents).toHaveLength(2);
    expect(result.outboxEvents[0]).toBe(existingEvent);
    expect(result.outboxEvents[1]).toMatchObject({
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
    ).rejects.toThrow('No endpoint configured for code "calculate-funding"');

    expect(callAgreementEndpoint).not.toHaveBeenCalled();
  });

  it("rejects an unsupported outbox event", async () => {
    await expect(
      runAgreementEffects(
        [{ ...publish, params: { event: "unsupported" } }],
        createContext(),
      ),
    ).rejects.toThrow('Unsupported Agreement outbox event: "unsupported"');
  });

  it("rejects an unsupported effect before running later effects", async () => {
    await expect(
      runAgreementEffects(
        [{ name: "unknownEffect" }, callEndpoint],
        createContext(),
      ),
    ).rejects.toThrow('Unsupported agreement effect: "unknownEffect"');

    expect(callAgreementEndpoint).not.toHaveBeenCalled();
  });
});
