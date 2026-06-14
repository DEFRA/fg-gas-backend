export const agreementCreationOutcomes = {
  ALREADY_CREATED: "already-created",
  CREATED: "created",
};

const lifecyclePublication = {
  lifecycleEvent: true,
};

export const createdAgreementResult = ({ agreement, item, version }) => ({
  outcome: agreementCreationOutcomes.CREATED,
  agreement,
  agreementId: agreement.id,
  agreementNumber: agreement.agreementNumber,
  sbi: agreement.sbi,
  item,
  publication: lifecyclePublication,
  version,
});

export const alreadyCreatedAgreementResult = ({ agreement, item }) => ({
  outcome: agreementCreationOutcomes.ALREADY_CREATED,
  agreement,
  agreementId: agreement.id,
  agreementNumber: agreement.agreementNumber,
  sbi: agreement.sbi,
  item,
  publication: {},
});
