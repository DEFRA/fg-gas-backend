import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import {
  loadCurrentAgreement,
  loadCurrentAgreementByItem,
} from "./load-current-agreement.js";

export const loadCurrentAgreementContext = async ({
  agreementNumber,
  agreementItemId,
  code,
  clientRef,
  sbi,
  session,
}) => {
  const currentAgreement = agreementItemId
    ? await loadCurrentAgreementByItem({
        agreementNumber,
        agreementItemId,
        session,
      })
    : await loadCurrentAgreement({ code, clientRef, sbi, session });
  const agreementDefinition = await loadAgreementDefinition({
    code: currentAgreement.code,
    configVersion: currentAgreement.configVersion,
  });

  return { currentAgreement, agreementDefinition };
};
