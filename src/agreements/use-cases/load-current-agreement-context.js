import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import {
  loadCurrentAgreement,
  loadCurrentAgreementByNumber,
} from "./load-current-agreement.js";

export const loadCurrentAgreementContext = async ({
  agreement: suppliedAgreement,
  agreementNumber,
  code,
  clientRef,
  sbi,
  session,
}) => {
  const agreement =
    suppliedAgreement ??
    (agreementNumber
      ? await loadCurrentAgreementByNumber({ agreementNumber, session })
      : await loadCurrentAgreement({ code, clientRef, sbi, session }));
  const agreementDefinition = await loadAgreementDefinition({
    code: agreement.code,
    configVersion: agreement.configVersion,
  });

  return { agreement, agreementDefinition };
};
