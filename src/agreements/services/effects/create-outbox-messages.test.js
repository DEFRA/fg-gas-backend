import { describe, expect, it } from "vitest";
import { config } from "../../../common/config.js";
import { createOutboxMessages } from "./create-outbox-messages.js";

describe("createOutboxMessages", () => {
  it("creates a lifecycle outbox message from the resulting Agreement", () => {
    const agreement = {
      agreementNumber: "PMF123",
      correlationId: "correlation-id",
      clientRef: "client-1",
      code: "pigs-might-fly",
      version: 2,
      state: "accepted",
      updatedAt: "2026-07-17T11:29:00.000Z",
    };

    const [message] = createOutboxMessages(["lifecycle"], agreement);

    expect(message).toMatchObject({
      target: config.sns.updateAgreementStatusTopicArn,
      event: {
        data: {
          agreementNumber: "PMF123",
          correlationId: "correlation-id",
          clientRef: "client-1",
          code: "pigs-might-fly",
          version: 2,
          status: "accepted",
          date: "2026-07-17T11:29:00.000Z",
        },
      },
    });
  });

  it("adds committed Agreement and Payment facts to the accepted lifecycle wire", () => {
    const agreement = {
      agreementNumber: "PMF123",
      correlationId: "correlation-id",
      clientRef: "client-1",
      code: "pigs-might-fly",
      version: 2,
      state: "accepted",
      startDate: "2026-08-01",
      endDate: "2027-07-31",
      updatedAt: "2026-07-17T11:29:00.000Z",
    };
    const payment = { paymentHubClaimId: "R00000001" };

    const [message] = createOutboxMessages(["lifecycle"], agreement, payment);

    expect(message).toEqual({
      target: config.sns.updateAgreementStatusTopicArn,
      event: expect.objectContaining({
        source: "urn:service:agreement",
        specversion: "1.0",
        type: "io.onsite.agreement.status.updated",
        datacontenttype: "application/json",
        messageGroupId: "client-1-pigs-might-fly",
        data: {
          agreementNumber: "PMF123",
          correlationId: "correlation-id",
          clientRef: "client-1",
          code: "pigs-might-fly",
          version: 2,
          status: "accepted",
          date: "2026-07-17T11:29:00.000Z",
          agreementUrl: "http://localhost:3000/PMF123",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          claimId: "R00000001",
        },
      }),
    });
  });

  it("rejects an unsupported outbox message type with a clear error", () => {
    expect(() => createOutboxMessages(["unknown"], {})).toThrow(
      'Unsupported Agreement outbox message type: "unknown"',
    );
  });
});
