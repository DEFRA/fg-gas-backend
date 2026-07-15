const matchesAgreementIdentity = (agreement, identity) => {
  if (!agreement) {
    return false;
  }

  return [
    agreement.agreementNumber === identity.agreementNumber,
    agreement.code === identity.code,
    agreement.identifiers?.sbi === identity.sbi,
  ].every(Boolean);
};

export const findAgreementItem = (items, { code, clientRef }) =>
  (items ?? []).find(
    (item) => item.agreementCode === code && item.clientRef === clientRef,
  );

export const findAgreementItemForIdentity = (agreement, identity) => {
  if (!matchesAgreementIdentity(agreement, identity)) {
    return undefined;
  }

  return findAgreementItem(agreement.items, identity);
};
