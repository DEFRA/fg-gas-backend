import { CloudEvent } from "../../../../common/cloud-event.js";
import { internalMessageTargets } from "../../../../common/internal-message-targets.js";

const createLifecycleOutboxEvent = (context) => ({
  event: new CloudEvent(
    "agreement.status.updated",
    {
      agreementNumber: context.agreement.agreementNumber,
      clientRef: context.item.clientRef,
      code: context.item.agreementCode,
      version: context.version,
      status: context.target,
      date: context.executedAt,
    },
    `${context.item.clientRef}-${context.item.agreementCode}`,
  ),
  target: internalMessageTargets.GRANTS,
});

export const publishEffect = async (context, { params = {} }) => {
  if (params.event !== "lifecycle") {
    throw new Error(`Unsupported Agreement outbox event: "${params.event}"`);
  }

  return {
    context: {
      outboxEvents: [
        ...(context.outboxEvents ?? []),
        createLifecycleOutboxEvent(context),
      ],
    },
  };
};
