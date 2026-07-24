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
});
