import { logger } from "../../common/logger.js";
import { resolveAgreementPageForStatus } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { renderAgreementPageFromVersion } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreement } from "./resolve-current-agreement.use-case.js";

export const findCurrentAgreementUseCase = async ({ code, clientRef, sbi }) => {
  logger.info(`Finding current agreement for code ${code}`);

  const { reference, version, item } = await resolveCurrentAgreement({
    code,
    clientRef,
    sbi,
  });
  const { pageId } = resolveAgreementPageForStatus({
    code: reference.code,
    status: item.status,
    configVersion: item.configVersion,
  });
  const renderedAgreement = await renderAgreementPageFromVersion({
    version,
    reference,
    page: pageId,
    mode: "view",
  });

  logger.info(`Finished: Finding current agreement for code ${code}`);

  return renderedAgreement;
};
