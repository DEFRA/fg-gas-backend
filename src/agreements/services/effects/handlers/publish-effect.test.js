import { describe, expect, it } from "vitest";
import { publishEffect } from "./publish-effect.js";

const context = {
  agreement: { agreementNumber: "PMF823153884" },
  item: {
    agreementCode: "pigs-might-fly",
    acceptedAt: "2026-07-17T11:29:00.000Z",
    clientRef: "xnp-rr3-nfb",
  },
  version: 2,
  target: "accepted",
  executedAt: "2026-07-17T11:30:00.000Z",
};

describe("publishEffect", () => {
  it("creates a payment-free Agreement lifecycle event", async () => {
    const result = await publishEffect(context, {
      params: { event: "lifecycle" },
    });

    expect(result.context.outboundEvents).toHaveLength(1);
    expect(result.context.outboundEvents[0]).toMatchObject({
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
    expect(result.context.outboundEvents[0].event.data).toEqual({
      agreementNumber: "PMF823153884",
      clientRef: "xnp-rr3-nfb",
      code: "pigs-might-fly",
      version: 2,
      status: "accepted",
      date: "2026-07-17T11:29:00.000Z",
    });
  });

  it("preserves existing outbound events", async () => {
    const existingEvent = { target: "existing-topic", event: { id: "one" } };
    const result = await publishEffect(
      { ...context, outboundEvents: [existingEvent] },
      { params: { event: "lifecycle" } },
    );

    expect(result.context.outboundEvents[0]).toBe(existingEvent);
    expect(result.context.outboundEvents).toHaveLength(2);
  });

  it("rejects unsupported publications", async () => {
    await expect(
      publishEffect(context, { params: { event: "unsupported" } }),
    ).rejects.toThrow('Unsupported Agreement publication: "unsupported"');
  });
});
