import { logger } from "../../common/logger.js";
import { resolveAgreementPageForStatus } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { renderAgreementPageFromVersionUseCase } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreementUseCase } from "./resolve-current-agreement.use-case.js";

export const findCurrentAgreementUseCase = async ({ code, clientRef, sbi }) => {
  logger.info(`Finding current agreement for code ${code}`);

  const { reference, version, item } = await resolveCurrentAgreementUseCase({
    code,
    clientRef,
    sbi,
  });
  const { pageId } = resolveAgreementPageForStatus({
    code: reference.code,
    status: item.status,
  });
  const renderedAgreement = await renderAgreementPageFromVersionUseCase({
    version,
    reference,
    page: pageId,
    mode: "view",
  });

  logger.info(`Finished: Finding current agreement for code ${code}`);

  return renderedAgreement;
};
