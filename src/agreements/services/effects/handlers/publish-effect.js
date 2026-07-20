import { CloudEvent } from "../../../../common/cloud-event.js";
import { config } from "../../../../common/config.js";

const getLifecycleDate = (context) =>
  context.target === "accepted" ? context.item.acceptedAt : context.executedAt;

const createLifecyclePublication = (context) => ({
  event: new CloudEvent(
    "agreement.status.updated",
    {
      agreementNumber: context.agreement.agreementNumber,
      clientRef: context.item.clientRef,
      code: context.item.agreementCode,
      version: context.version,
      status: context.target,
      date: getLifecycleDate(context),
    },
    `${context.item.clientRef}-${context.item.agreementCode}`,
  ),
  target: config.sns.updateAgreementStatusTopicArn,
});

export const publishEffect = async (context, { params = {} }) => {
  if (params.event !== "lifecycle") {
    throw new Error(`Unsupported Agreement publication: "${params.event}"`);
  }

  return {
    context: {
      outboundEvents: [
        ...(context.outboundEvents ?? []),
        createLifecyclePublication(context),
      ],
    },
  };
};
