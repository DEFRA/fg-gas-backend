import { logger } from "../../common/logger.js";
import { resolveAgreementPageForStatus } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { renderAgreementPageFromVersion } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreementByIdentity } from "./resolve-current-agreement.use-case.js";

const toCurrentAgreementResponse = (renderedAgreement) => ({
  ...renderedAgreement,
  page: { title: renderedAgreement.page.title },
});

export const findCurrentAgreementUseCase = async ({ code, clientRef, sbi }) => {
  logger.info(`Finding current agreement for code ${code}`);

  const { identity, version, item } = await resolveCurrentAgreementByIdentity({
    code,
    clientRef,
    sbi,
  });
  const { pageId } = resolveAgreementPageForStatus({
    code: identity.code,
    status: item.status,
    configVersion: item.configVersion,
  });
  const renderedAgreement = await renderAgreementPageFromVersion({
    version,
    identity,
    page: pageId,
    mode: "view",
  });

  logger.info(`Finished: Finding current agreement for code ${code}`);

  return toCurrentAgreementResponse(renderedAgreement);
};
