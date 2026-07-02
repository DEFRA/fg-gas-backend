import { pmfAgreementDefinition } from "./pmf.js";

const agreementDefinitionsByCode = {
  [pmfAgreementDefinition.code]: pmfAgreementDefinition,
};

export const getAgreementDefinitionByCode = (code) =>
  agreementDefinitionsByCode[code];
