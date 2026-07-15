import { logger } from "../../common/logger.js";
import { renderAgreementPageFromVersion } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreementByIdentity } from "./resolve-current-agreement.use-case.js";

export const renderAgreementPageUseCase = async ({
  code,
  clientRef,
  sbi,
  page,
  mode,
}) => {
  logger.info(`Rendering page "${page}" (mode "${mode}") for code ${code}`);

  const { identity, version } = await resolveCurrentAgreementByIdentity({
    code,
    clientRef,
    sbi,
  });
  const renderModel = await renderAgreementPageFromVersion({
    version,
    identity,
    page,
    mode,
  });

  logger.info(`Finished: Rendering page "${page}" for code ${code}`);

  return renderModel;
};
