export const agreementCreationOutcomes = {
  ALREADY_CREATED: "already-created",
  CREATED: "created",
};

export const createdAgreementResult = ({ agreement, item, version }) => ({
  outcome: agreementCreationOutcomes.CREATED,
  agreement,
  agreementId: agreement.id,
  agreementNumber: agreement.agreementNumber,
  sbi: agreement.sbi,
  item,
  version,
});

export const alreadyCreatedAgreementResult = ({ agreement, item }) => ({
  outcome: agreementCreationOutcomes.ALREADY_CREATED,
  agreementId: agreement.id,
  agreementNumber: agreement.agreementNumber,
  sbi: agreement.sbi,
  item,
});
