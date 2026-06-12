import { config } from "../../common/config.js";
import { Outbox } from "../../grants/models/outbox.js";
import {
  existsByEventId,
  insertMany,
} from "../../grants/repositories/outbox.repository.js";
import { AgreementCreatedEvent } from "../events/agreement-created.event.js";

const createAgreementLifecycleEventData = ({ agreement, item, version }) => {
  const itemState = version.findItemState(item.agreementItemId);

  return {
    eventId: version.id,
    agreementId: agreement.id,
    agreementVersionId: version.id,
    agreementItemId: item.agreementItemId,
    agreementNumber: agreement.agreementNumber,
    agreementCode: item.agreementCode,
    code: item.agreementCode,
    clientRef: item.clientRef,
    changeType: version.change.type,
    changedAt: version.createdAt,
    changedBy: version.change.changedBy,
    fromStatus: version.change.fromStatus,
    toStatus: itemState.status,
    status: itemState.status,
    date: version.createdAt,
    startDate: itemState.payment?.agreementStartDate,
    endDate: itemState.payment?.agreementEndDate,
    claimId: itemState.claimId,
  };
};

const createOutboxRecord = (event) =>
  new Outbox({
    event,
    target: config.sns.agreementStatusUpdatedTopicArn,
    segregationRef: Outbox.getSegregationRef(event),
  });

export const publishAgreementLifecycle = async (
  { agreement, item, version },
  session,
) => {
  const event = new AgreementCreatedEvent(
    createAgreementLifecycleEventData({ agreement, item, version }),
  );

  if (await existsByEventId(event.data.eventId, session)) {
    return;
  }

  await insertMany([createOutboxRecord(event)], session);
};
