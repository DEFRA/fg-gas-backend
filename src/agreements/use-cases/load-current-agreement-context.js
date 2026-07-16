import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { loadCurrentAgreement } from "./load-current-agreement.js";

export const loadCurrentAgreementContext = async ({
  code,
  clientRef,
  sbi,
  session,
}) => {
  const currentAgreement = await loadCurrentAgreement({
    code,
    clientRef,
    sbi,
    session,
  });
  const agreementDefinition = await loadAgreementDefinition({
    code: currentAgreement.code,
    configVersion: currentAgreement.configVersion,
  });

  return { currentAgreement, agreementDefinition };
};
