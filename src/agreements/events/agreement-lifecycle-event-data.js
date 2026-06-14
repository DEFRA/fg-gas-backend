export const createAgreementLifecycleEventData = ({
  agreement,
  item,
  version,
}) => {
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
