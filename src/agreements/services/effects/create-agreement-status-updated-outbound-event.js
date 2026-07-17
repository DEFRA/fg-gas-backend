import { config } from "../../../common/config.js";
import { AgreementStatusUpdatedEvent } from "../../events/agreement-status-updated.event.js";

const getStatusChangedAt = (context) =>
  context.target === "accepted" ? context.item.acceptedAt : context.executedAt;

export const createAgreementStatusUpdatedOutboundEvent = (context) => ({
  event: new AgreementStatusUpdatedEvent({
    agreementNumber: context.agreement.agreementNumber,
    clientRef: context.item.clientRef,
    code: context.item.agreementCode,
    version: context.version,
    status: context.target,
    date: getStatusChangedAt(context),
  }),
  target: config.sns.updateAgreementStatusTopicArn,
});
