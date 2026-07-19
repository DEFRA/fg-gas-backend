import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import {
  loadCurrentAgreement,
  loadCurrentAgreementByItem,
} from "./load-current-agreement.js";

const loadContext = async (currentAgreement) => {
  const agreementDefinition = await loadAgreementDefinition({
    code: currentAgreement.code,
    configVersion: currentAgreement.configVersion,
  });

  return { currentAgreement, agreementDefinition };
};

export const loadCurrentAgreementContextByReference = async ({
  code,
  clientRef,
  sbi,
  session,
}) =>
  loadContext(await loadCurrentAgreement({ code, clientRef, sbi, session }));

export const loadCurrentAgreementContextByItem = async ({
  agreementNumber,
  agreementItemId,
  session,
}) =>
  loadContext(
    await loadCurrentAgreementByItem({
      agreementNumber,
      agreementItemId,
      session,
    }),
  );
