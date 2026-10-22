import { insertAgreementDefinition } from "../repositories/agreement-definition.repository.js";
import { checkAgreementDefinition } from "./compile-agreement-definition.js";

// An operator's Fetch Definitions: the file is held to the check it met on arrival, then
// stored as published. No fetch status is written.
export const storeAgreementDefinition = async ({
  grantCode,
  version,
  definition,
}) => {
  checkAgreementDefinition(definition, grantCode, version);
  await insertAgreementDefinition({ code: grantCode, version, definition });
};
