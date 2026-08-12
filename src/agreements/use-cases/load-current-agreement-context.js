import { toEtag } from "./agreement-etag.js";
import { loadAgreementDefinition } from "./load-agreement-definition.js";
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
    resolution: agreement.state === "accepted" ? "exact" : "same-major",
  });

  return {
    agreement,
    agreementDefinition,
    etag: toEtag(agreement, agreementDefinition.configVersion),
  };
};
