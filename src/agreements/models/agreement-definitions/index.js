import { pmfAgreementDefinition } from "./pmf.js";

const agreementDefinitionsByCode = {
  [pmfAgreementDefinition.code]: pmfAgreementDefinition,
};

export const agreementDefinitions = Object.values(agreementDefinitionsByCode);

export const getAgreementDefinitionByCode = (code) =>
  agreementDefinitionsByCode[code];
