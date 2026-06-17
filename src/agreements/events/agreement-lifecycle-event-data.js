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
    agreementCode: agreement.code,
    code: agreement.code,
    clientRef: item.clientRef,
    changedAt: version.createdAt,
    status: itemState.status,
    date: version.createdAt,
    startDate: itemState.payment?.agreementStartDate,
    endDate: itemState.payment?.agreementEndDate,
    claimId: itemState.claimId,
  };
};
