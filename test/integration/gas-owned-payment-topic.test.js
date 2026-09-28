import { randomUUID } from "node:crypto";
import { env } from "node:process";
import { expect, it, vi } from "vitest";
import { config } from "../../src/common/config.js";
import { publish } from "../../src/common/sns-client.js";
import { receiveMessages } from "../helpers/sqs.js";

it("delivers an unchanged GAS Payment event to the existing GPS queue", async () => {
  const event = {
    id: randomUUID(),
    source: "urn:service:agreement",
    type: "io.onsite.agreement.create-payment",
    data: { claimId: "R00000001" },
  };

  await publish(config.sns.createPaymentTopicArn, event, {
    messageGroupId: "agreement-1",
    deduplicationId: event.id,
  });

  await vi.waitFor(
    async () => {
      const messages = await receiveMessages(env.CREATE_PAYMENT_QUEUE_URL);
      expect(messages).toContainEqual(event);
    },
    { timeout: 5000 },
  );
});
