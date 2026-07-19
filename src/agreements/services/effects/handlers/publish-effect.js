import { createAgreementStatusUpdatedOutboundEvent } from "../create-agreement-status-updated-outbound-event.js";

export const publishEffect = async (context, { params = {} }) => {
  if (params.event !== "agreementStatusUpdated") {
    throw new Error(`Unsupported Agreement publication: "${params.event}"`);
  }

  return {
    context: {
      outboundEvents: [
        ...(context.outboundEvents ?? []),
        createAgreementStatusUpdatedOutboundEvent(context),
      ],
    },
  };
};
