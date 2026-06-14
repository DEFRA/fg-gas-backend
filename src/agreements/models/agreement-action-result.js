export const agreementActionResult = ({
  agreement,
  item,
  publication,
  status,
  version,
}) => ({
  agreement,
  agreementId: agreement.id,
  agreementItemId: item.agreementItemId,
  agreementNumber: agreement.agreementNumber,
  clientRef: item.clientRef,
  code: item.agreementCode,
  item,
  publication,
  status,
  version,
});
